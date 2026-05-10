const DB_ID = "32aa73a6-3cf7-80be-aecf-e80c8a867560";
const NOTION_VERSION = "2022-06-28";
const MAX_PROGRAMME_CHARS = 3000;
const MAX_DEPTH = 2;

const plainText = (rich) => (rich || []).map((r) => r.plain_text).join("").trim();
const multiNames = (ms) => (ms || []).map((o) => o.name);

function getDays(duree) {
  const m = (duree || "").match(/(\d+)\s*j/i);
  return m ? parseInt(m[1], 10) : 0;
}

function computeCpfPrice(titre, prixSansCpf, duree) {
  const t = (titre || "").toLowerCase();
  const days = getDays(duree);

  if (t.includes("combo") && (t.includes("microshading") || t.includes("micro")) && (t.includes("blush") || t.includes("lips"))) {
    return { 3: 2400, 4: 2800, 5: 3200 }[days] || null;
  }
  if (t.includes("combo") && (t.includes("browlift") || t.includes("rehaussement") || t.includes("réhaussement"))) {
    return 1500;
  }
  if (t.includes("extension")) {
    return { 2: 1500, 3: 1800 }[days] || null;
  }
  if (t.includes("microshading")) {
    return { 3: 2250, 4: 2400, 5: 2800 }[days] || null;
  }
  if (t.includes("blush") || t.includes("lips")) {
    return { 2: 1800, 3: 2250, 4: 2400 }[days] || null;
  }
  if (t.includes("perfectionnement") || t.includes("perfect")) {
    return { 1: 1400, 2: 1650 }[days] || null;
  }
  if (t.includes("coaching")) return 1500;
  return null;
}

function computePlacesMax(titre) {
  const t = (titre || "").toLowerCase();
  if (t.includes("coaching")) return 1;
  if (t.includes("microshading") || t.includes("blush") || t.includes("lips") || t.includes("dermopig")) return 2;
  return 3;
}

function extractBlockText(block) {
  const t = block.type;
  const data = block[t];
  if (!data) return "";
  switch (t) {
    case "paragraph":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "quote":
    case "toggle":
    case "callout":
      return plainText(data.rich_text);
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return "\n## " + plainText(data.rich_text);
    case "table_row":
      return (data.cells || []).map((cell) => plainText(cell)).join(" | ");
    default:
      return "";
  }
}

async function fetchBlockChildren(blockId, token, depth = 0) {
  if (depth > MAX_DEPTH) return "";
  try {
    const res = await fetch(
      `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
        },
      }
    );
    if (!res.ok) return "";
    const data = await res.json();
    let text = "";
    for (const block of data.results) {
      const blockText = extractBlockText(block);
      if (blockText) text += blockText + "\n";
      if (block.has_children && text.length < MAX_PROGRAMME_CHARS) {
        const childText = await fetchBlockChildren(block.id, token, depth + 1);
        if (childText) text += childText;
      }
      if (text.length >= MAX_PROGRAMME_CHARS) break;
    }
    return text;
  } catch {
    return "";
  }
}

function compactProgramme(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, MAX_PROGRAMME_CHARS);
}

module.exports = async (req, res) => {
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  if (!NOTION_TOKEN) {
    res.status(500).json({ error: "NOTION_TOKEN not configured" });
    return;
  }

  try {
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "Statut", multi_select: { contains: "Actif" } },
        page_size: 50,
      }),
    });

    if (!queryRes.ok) {
      const errorText = await queryRes.text();
      res.status(queryRes.status).json({ error: "Notion API error", detail: errorText });
      return;
    }

    const data = await queryRes.json();

    const formations = await Promise.all(
      data.results.map(async (page) => {
        const p = page.properties;
        const titre = plainText(p["Intitulé de la formation"]?.title);
        const duree = plainText(p["Durée"]?.rich_text);
        const prix = p["Prix"]?.number ?? null;
        const fin = multiNames(p["Financement éligible"]?.multi_select);
        const inscription = multiNames(p["Statut inscription"]?.multi_select)[0] || "";
        const cpfEligible = fin.includes("CPF");

        const rawProgramme = await fetchBlockChildren(page.id, NOTION_TOKEN);
        const programme = compactProgramme(rawProgramme);

        return {
          titre,
          duree,
          prix_sans_cpf: prix,
          cpf_eligible: cpfEligible,
          prix_avec_cpf: cpfEligible ? computeCpfPrice(titre, prix, duree) : null,
          fafcea: fin.includes("FAFCEA"),
          alma: fin.some((f) => f.toLowerCase().includes("alma")),
          opco: fin.includes("OPCO"),
          statut_inscription: inscription,
          prerequis: plainText(p["Prérequis"]?.rich_text),
          public: plainText(p["Public cible"]?.rich_text),
          objectifs: plainText(p["Objectifs"]?.rich_text),
          lien_inscription: p["Lien inscription"]?.url || "",
          places_max: computePlacesMax(titre),
          programme,
        };
      })
    );

    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({ formations, last_updated: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
