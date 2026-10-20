const mangayomiSources = [{
    "name": "Okanime",
    "lang": "ar",
    "baseUrl": "https://ww3.okanime.xyz",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/QuillDev/mangayomi-extensions/main/javascript/icon/ar.okanime.png",
    "typeSource": "single",
    "isManga": false,
    "itemType": 1,
    "version": "0.2.0",
    "pkgPath": "anime/src/ar/okanime.js"
}];

const QUALITIES = { FHD: "1080p", HD: "720p", SD: "480p" };

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get baseUrl() {
        return this.source.baseUrl;
    }

    async page(path) {
        const doc = new Document((await this.client.get(this.baseUrl + path)).body);
        const list = doc.select(".anime-card").map((card) => {
            const link = card.selectFirst(".anime-title h4 a");
            return { name: link.text.trim(), link: link.attr("href"), imageUrl: card.selectFirst("img").attr("src") };
        }).filter((item) => item.link.includes("/anime/"));
        return { list, hasNextPage: doc.selectFirst("a[rel=next]").attr("href") !== "" };
    }

    getPopular(page) {
        return this.page(`/anime-list?sort=popular&page=${page}`);
    }

    getLatestUpdates(page) {
        return this.page(`/anime-list?page=${page}`);
    }

    search(query, page) {
        return this.page(`/search?q=${encodeURIComponent(query.trim())}${page > 1 ? `&page=${page}` : ""}`);
    }

    async getDetail(url) {
        const doc = new Document((await this.client.get(url)).body);
        const meta = (label) => doc.select(".animepage-meta-row dt").filter((dt) => dt.text.trim() === label).map((dt) => dt.nextElementSibling.text.trim())[0] || "";
        const state = meta("الحالة");
        const episodes = doc.select(".ep-compact-grid a").map((a) => ({
            name: `الحلقة ${a.text.trim()}`,
            url: a.attr("href"),
        }));
        return {
            name: doc.selectFirst("h1").text.trim() || doc.selectFirst(".animepage-h1").text.trim(),
            imageUrl: doc.selectFirst("meta[property=og:image]").attr("content"),
            description: doc.selectFirst(".synopsis-text").text.trim(),
            genre: doc.select(".animepage-genres a").map((a) => a.text.trim()),
            status: state.includes("مكتمل") ? 1 : state.includes("يعرض") ? 0 : 5,
            episodes: episodes.reverse(),
        };
    }

    async getVideoList(url) {
        const html = (await this.client.get(url)).body;
        const links = [...html.matchAll(/activeUrl === '([^']+)'[^>]*matchesQuality\('([^']+)'\)/g)];
        const enabled = new SharedPreferences().get("hoster_selection") || ["Mp4upload", "Uqload", "Dood", "Voe", "Okru", "VidBom"];
        const videos = [];
        for (const [, link, label] of links) {
            const quality = QUALITIES[label.trim()] || label.trim();
            try {
                videos.push(...await this.extract(link, quality, enabled));
            } catch (_) {
                // A dead host shouldn't hide the others.
            }
        }
        return this.sortVideos(videos);
    }

    async extract(link, quality, enabled) {
        const use = (host) => enabled.includes(host);
        if (link.includes("mp4upload") && use("Mp4upload")) return mp4UploadExtractor(link, null, "", "");
        if (link.includes("uqload") && use("Uqload")) return this.uqload(link, quality);
        if (/dood|d000d|ds2play/.test(link) && use("Dood")) return doodExtractor(link, `DoodStream - ${quality}`);
        if (link.includes("voe.sx") && use("Voe")) return voeExtractor(link, `VoeSX ${quality} `);
        if (link.includes("ok.ru") && use("Okru")) return okruExtractor(link);
        if (/vidbam|vadbam|vidbom|vidbm/.test(link) && use("VidBom")) return vidBomExtractor(link);
        return [];
    }

    async uqload(url, quality) {
        const fixed = url.replace(/^https?:\/\/(?:www\.)?[^/]+\//, "https://uqload.is/");
        const headers = { Referer: "https://uqload.is/" };
        const match = /sources\s*:\s*\[\s*["'](https?:\/\/[^"']+)["']\s*\]/.exec((await this.client.get(fixed, headers)).body);
        return match ? [{ url: match[1], originalUrl: match[1], quality: `Uqload - ${quality}`, headers }] : [];
    }

    sortVideos(videos) {
        const quality = new SharedPreferences().get("preferred_quality") || "1080";
        const height = (video) => Number((/(\d+)p/.exec(video.quality) || [0, 0])[1]);
        return videos.sort((a, b) => (b.quality.includes(quality) - a.quality.includes(quality)) || height(b) - height(a));
    }

    getSourcePreferences() {
        const hosts = ["Mp4upload", "Uqload", "Dood", "Voe", "Okru", "VidBom"];
        return [
            { key: "preferred_quality", listPreference: { title: "Preferred Quality", summary: "", valueIndex: 0, entries: ["1080p", "720p", "480p"], entryValues: ["1080", "720", "480"] } },
            { key: "hoster_selection", multiSelectListPreference: { title: "Enable/Disable Hosts", summary: "", entries: hosts, entryValues: hosts, values: hosts } },
        ];
    }
}
