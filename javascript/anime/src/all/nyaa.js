const mangayomiSources = [{
    "name": "Nyaa",
    "lang": "all",
    "baseUrl": "https://nyaa.si",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/QuillDev/mangayomi-extensions/main/javascript/icon/all.nyaa.png",
    "typeSource": "torrent",
    "isManga": false,
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/all/nyaa.js"
}];

// Each Nyaa torrent is one result; its single "episode" is the torrent's magnet.
class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() {
        const domain = (new SharedPreferences().get("domain_url") || "").trim();
        const base = domain === "" ? this.source.baseUrl : domain;
        return base.endsWith("/") ? base.slice(0, -1) : base;
    }

    async list(params) {
        const category = new SharedPreferences().get("preferred_categorie_page");
        const res = await this.client.get(`${this.getBaseUrl()}/?f=0&c=${category}&${params}`);
        const doc = new Document(res.body);
        const list = [];
        for (const row of doc.select("table.torrent-list > tbody > tr")) {
            const title = row.select("td:nth-child(2) a").find((a) => a.attr("href").includes("/view/") && !a.attr("href").includes("#comments"));
            if (!title) continue;
            const size = row.selectFirst("td:nth-child(4)").text.trim();
            const seeders = row.selectFirst("td:nth-child(6)").text.trim();
            list.push({
                name: title.attr("title") || title.text.trim(),
                link: this.getBaseUrl() + title.attr("href"),
                imageUrl: this.getBaseUrl() + row.selectFirst("td:nth-child(1) img").attr("src"),
                description: `${size} · ${seeders} seeders`,
            });
        }
        const hasNextPage = doc.select("ul.pagination li a").some((a) => a.text.includes("»") && !a.attr("href").includes("#"));
        return { list, hasNextPage };
    }

    getPopular(page) {
        return this.list(`q=&s=downloads&o=desc&p=${page}`);
    }

    getLatestUpdates(page) {
        return this.list(`q=&p=${page}`);
    }

    search(query, page, filters) {
        let params = `q=${encodeURIComponent(query)}&p=${page}`;
        const sort = (filters || []).find((filter) => filter.type_name === "SortFilter");
        if (sort && sort.state && sort.values[sort.state.index]) {
            const by = sort.values[sort.state.index].value;
            if (by !== "") params += `&s=${by}&o=${sort.state.ascending ? "asc" : "desc"}`;
        }
        return this.list(params);
    }

    async getDetail(url) {
        const res = await this.client.get(url);
        const doc = new Document(res.body);
        const info = doc.select(".panel-body .row .col-md-1").map((label) => {
            const value = label.nextElementSibling;
            return `${label.text.replace(":", "").trim()}: ${value ? value.text.trim() : ""}`;
        });
        let description = info.join("\n");
        if (new SharedPreferences().get("torrent_description_visible")) {
            description += "\n\n" + doc.select("#torrent-description").map((e) => e.text.trim()).join("\n\n");
        }
        const magnet = doc.select("a").map((a) => a.attr("href")).find((href) => href.startsWith("magnet:"));
        return {
            name: doc.selectFirst("h3.panel-title").text.trim(),
            description,
            episodes: magnet ? [{ name: "Torrent", url: magnet }] : [],
        };
    }

    async getVideoList(url) {
        return [{ url, originalUrl: url, quality: "" }];
    }

    getFilterList() {
        return [{
            type_name: "SortFilter",
            type: "SortFilter",
            name: "Sort by",
            state: { type_name: "SortState", index: 0, ascending: false },
            values: [
                ["None", ""], ["Size", "size"], ["Date", "id"], ["Seeders", "seeders"], ["Leechers", "leechers"], ["Downloads", "downloads"],
            ].map(([name, value]) => ({ type_name: "SelectOption", name, value })),
        }];
    }

    getSourcePreferences() {
        return [
            {
                key: "preferred_categorie_page",
                listPreference: { title: "Category", summary: "", valueIndex: 0, entries: ["Anime", "Live Action"], entryValues: ["1_0", "4_0"] },
            },
            {
                key: "torrent_description_visible",
                switchPreferenceCompat: { title: "Show the torrent description", summary: "", value: false },
            },
            {
                key: "domain_url",
                editTextPreference: { title: "Site address", summary: "", value: "https://nyaa.si", dialogTitle: "URL", dialogMessage: "" },
            },
        ];
    }
}
