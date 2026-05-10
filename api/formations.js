const DB_ID = "32aa73a6-3cf7-80be-aecf-e80c8a867560";

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

module.exports = async (req, res) => {
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  if (!NOTION_TOKEN) {
    res.status(500).json({ error: "NOTION_TOKEN not configured" });
    return;
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "Statut", multi_select: { contains: "Actif" } },
        page_size: 50,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: "Notion API error", detail: errorText });
      return;
    }

    const data = await response.json();

    const formations = data.results.map((page) => {
      const p = page.properties;
      const titre = plainText(p["Intitulé de la formation"]?.title);
      const duree = plainText(p["Durée"]?.rich_text);
      const prix = p["Prix"]?.number ?? null;
      const fin = multiNames(p["Financement éligible"]?.multi_select);
      const inscription = multiNames(p["Statut inscription"]?.multi_select)[0] || "";
      const cpfEligible = fin.includes("CPF");

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
      };
    });

    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ formations, last_updated: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
