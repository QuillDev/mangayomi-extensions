const mangayomiSources = [{
    "name": "NimeGami",
    "lang": "id",
    "baseUrl": "https://nimegami.id",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/QuillDev/mangayomi-extensions/main/javascript/icon/id.nimegami.png",
    "typeSource": "single",
    "isManga": false,
    "itemType": 1,
    "version": "0.2.0",
    "pkgPath": "anime/src/id/nimegami.js"
}];

/** The JSON value starting at `start` (an array or object), found by matching brackets outside strings. */
function jsonAt(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (char === "\\") i++;
            else if (char === '"') inString = false;
        } else if (char === '"') {
            inString = true;
        } else if (char === "[" || char === "{") {
            depth++;
        } else if (char === "]" || char === "}") {
            depth--;
            if (depth === 0) return JSON.parse(text.substring(start, i + 1));
        }
    }
    return null;
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    async html(path) {
        const res = await this.client.get(path.startsWith("http") ? path : this.source.baseUrl + path);
        if (res.statusCode !== 200) throw new Error(`NimeGami answered ${res.statusCode}`);
        return res.body;
    }

    cards(html) {
        const doc = new Document(html);
        const list = doc.select("article.anime-card a.poster-link").map((a) => ({
            name: a.selectFirst("img").attr("alt"),
            link: a.attr("href"),
            imageUrl: this.source.baseUrl + (a.selectFirst("img").attr("src") || ""),
        }));
        const hasNextPage = doc.select("a").some((a) => a.attr("rel") === "next" || a.attr("aria-label").toLowerCase().includes("berikut"));
        return { list, hasNextPage };
    }

    async getPopular(page) {
        return this.cards(await this.html(`/anime/?sort=popular${page > 1 ? `&page=${page}` : ""}`));
    }

    async getLatestUpdates(page) {
        return this.cards(await this.html(`/anime/?sort=updated${page > 1 ? `&page=${page}` : ""}`));
    }

    async search(query, page, filters) {
        return this.cards(await this.html(`/anime/?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ""}`));
    }

    /** Next.js streams page data in `self.__next_f.push` chunks; joined, they hold every download/stream link. */
    links(html) {
        // Scanned by hand: a backtracking regex over a 600 KB page breaks QuickJS's regex engine.
        const marker = 'self.__next_f.push([1,"';
        const chunks = [];
        for (let at = html.indexOf(marker); at >= 0; at = html.indexOf(marker, at + 1)) {
            const start = at + marker.length;
            let end = start;
            while (end < html.length && html[end] !== '"') end += html[end] === "\\" ? 2 : 1;
            chunks.push(JSON.parse(`"${html.substring(start, end)}"`));
        }
        const data = chunks.join("");
        const start = data.indexOf('"links":[');
        return start < 0 ? [] : jsonAt(data, start + 8) || [];
    }

    series(html) {
        for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
            const parsed = JSON.parse(match[1]);
            const found = (parsed["@graph"] || [parsed]).find((item) => item["@type"] === "TVSeries" || item["@type"] === "Movie");
            if (found) return found;
        }
        return {};
    }

    async getDetail(url) {
        const html = await this.html(url);
        const series = this.series(html);
        const numbers = [...new Set(this.links(html).filter((link) => link.kind === "episode" && link.episode !== null).map((link) => link.episode))];
        return {
            name: series.name || "",
            imageUrl: series.image || "",
            description: series.description || "",
            genre: Array.isArray(series.genre) ? series.genre : [],
            episodes: numbers.sort((a, b) => b - a).map((number) => ({ name: `Episode ${number}`, url: `${url}#episode_${number}` })),
        };
    }

    /** A link Nanime or a player can fetch directly, or null when the host needs its own extractor. */
    direct(link) {
        if (link.provider === "BerkasDrive" && link.url.includes("/hal/download/")) {
            return link.url.replace("/hal/download/", "/public/download/");
        }
        const pixeldrain = /pixeldrain\.com\/u\/([A-Za-z0-9]+)/.exec(link.url);
        return pixeldrain ? `https://pixeldrain.com/api/file/${pixeldrain[1]}` : null;
    }

    async getVideoList(url) {
        const [page, fragment] = url.split("#episode_");
        const episode = Number(fragment);
        const preferred = new SharedPreferences().get("preferred_quality");
        const seen = new Set();
        const videos = [];
        for (const link of this.links(await this.html(page))) {
            const direct = link.kind === "episode" && link.episode === episode ? this.direct(link) : null;
            if (direct && !seen.has(direct)) {
                seen.add(direct);
                videos.push({ url: direct, originalUrl: direct, quality: `${link.provider} - ${link.quality}` });
            }
        }
        const rank = (video) => (video.quality.endsWith(preferred) ? 10000 : 0) + Number((/(\d+)p/.exec(video.quality) || [0, 0])[1]);
        return videos.sort((a, b) => rank(b) - rank(a));
    }

    getFilterList() {
        return [];
    }

    getSourcePreferences() {
        return [{
            key: "preferred_quality",
            listPreference: { title: "Kualitas", summary: "", valueIndex: 1, entries: ["1080p", "720p", "480p", "360p"], entryValues: ["1080p", "720p", "480p", "360p"] },
        }];
    }
}
