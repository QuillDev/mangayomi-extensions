const mangayomiSources = [{
    "name": "AnimeSaturn",
    "lang": "it",
    "baseUrl": "https://www.animesaturn.net",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/QuillDev/mangayomi-extensions/main/javascript/icon/it.animesaturn.png",
    "typeSource": "single",
    "isManga": false,
    "itemType": 1,
    "version": "0.2.0",
    "pkgPath": "anime/src/it/animesaturn.js"
}];

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 to byte values; QuickJS (and so Mangayomi) has no atob. */
function base64Bytes(input) {
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const char of input.replace(/[^A-Za-z0-9+/]/g, "")) {
        buffer = (buffer << 6) | BASE64.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return bytes;
}

function unescapeHtml(text) {
    return text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    async page(path) {
        const url = path.startsWith("http") ? path : this.source.baseUrl + path;
        const res = await this.client.get(url);
        if (res.statusCode !== 200) throw new Error(`AnimeSaturn answered ${res.statusCode}`);
        return new Document(res.body);
    }

    /** The poster cards every listing page uses. */
    cards(doc) {
        const list = doc.select("a.ac").map((card) => {
            const img = card.selectFirst(".ac__poster img");
            return { name: img.attr("alt").trim(), link: card.attr("href"), imageUrl: img.attr("src") };
        });
        return { list, hasNextPage: doc.selectFirst("a[rel=next]").attr("href") !== "" };
    }

    async getPopular(page) {
        return this.cards(await this.page(page > 1 ? `/ongoing/${page}` : "/ongoing"));
    }

    async getLatestUpdates(page) {
        return this.cards(await this.page(page > 1 ? `/newest/${page}` : "/newest"));
    }

    async search(query, page, filters) {
        const key = encodeURIComponent(query);
        return this.cards(await this.page(page > 1 ? `/filter/${page}?key=${key}` : `/filter?key=${key}`));
    }

    async getDetail(url) {
        const doc = await this.page(url);
        const status = doc.select("a[href^='/filter?states=']").map((a) => a.text).join(" ");
        const episodes = doc.select("a.ep-tile").map((a) => ({
            name: a.attr("title") || `Episodio ${a.text.trim()}`,
            url: a.attr("href").replace("/episode/", "/anime/"),
        }));
        return {
            name: doc.selectFirst("h1").text.trim(),
            imageUrl: doc.selectFirst(".ag-poster img").attr("src"),
            description: doc.selectFirst("section.ag-story > div").text.trim(),
            genre: doc.select("header a.chip").map((a) => a.text.trim()),
            status: status.includes("In corso") ? 0 : status.includes("Finito") ? 1 : 5,
            episodes: episodes.reverse(),
        };
    }

    /** The watch page lists its servers as JSON in the player's x-data attribute. */
    async servers(url) {
        const res = await this.client.get(url.startsWith("http") ? url : this.source.baseUrl + url);
        const data = /x-data="watchPage\((.*?)\)"/s.exec(res.body);
        return data ? JSON.parse(unescapeHtml(data[1])).servers || [] : [];
    }

    /** Saturn's own player: the page holds a token; its playlist answer is the video link XOR'd with it. */
    async saturnVideo(embedUrl) {
        const page = (await this.client.get(embedUrl, { Referer: `${this.source.baseUrl}/` })).body;
        const params = /i:(\d+),k:"([^"]+)",e:(\d+)/.exec(page);
        if (!params) return null;
        const [, id, key, expires] = params;
        const origin = embedUrl.substring(0, embedUrl.indexOf("/", 8));
        const res = await this.client.get(`${origin}/embed/${id}/playlist?token=${encodeURIComponent(key)}&expires=${expires}`, { Referer: embedUrl });
        const bytes = base64Bytes(JSON.parse(res.body).d || "");
        const source = bytes.map((byte, index) => String.fromCharCode(byte ^ key.charCodeAt(index % key.length))).join("");
        return source.startsWith("http") ? source : null;
    }

    async getVideoList(url) {
        const videos = [];
        for (const server of await this.servers(url)) {
            try {
                if (server.download && server.downloadUrl) {
                    videos.push({ url: server.downloadUrl, originalUrl: server.downloadUrl, quality: server.name });
                } else if (server.link && server.link.includes("saturncdn")) {
                    const video = await this.saturnVideo(server.link);
                    if (video) videos.push({ url: video, originalUrl: video, quality: server.name, headers: { Referer: server.link } });
                }
            } catch (_) {
                // One broken server shouldn't hide the others.
            }
        }
        return videos;
    }

    getFilterList() {
        return [];
    }

    getSourcePreferences() {
        return [];
    }
}
