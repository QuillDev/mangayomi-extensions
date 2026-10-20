const mangayomiSources = [{
    "name": "DonghuaStream",
    "lang": "en",
    "baseUrl": "https://donghuastream.org",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/QuillDev/mangayomi-extensions/main/javascript/icon/en.donghuastream.png",
    "typeSource": "single",
    "isManga": false,
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/en/donghuastream.js"
}];

/** Base64 to text; QuickJS (and so Mangayomi) has no atob. */
function base64Decode(input) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = input.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
        buffer = (buffer << 6) | alphabet.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return decodeURIComponent(bytes.map((byte) => "%" + byte.toString(16).padStart(2, "0")).join(""));
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    async page(url) {
        const res = await this.client.get(url);
        if (res.statusCode !== 200) throw new Error(`DonghuaStream answered ${res.statusCode}`);
        return new Document(res.body);
    }

    parseList(doc, nextSelector) {
        const list = doc.select("article.bs > div > a").map((a) => {
            const img = a.selectFirst("img");
            return { name: a.attr("title"), link: a.attr("href"), imageUrl: img.attr("data-src") || img.attr("src") };
        });
        return { list, hasNextPage: doc.selectFirst(nextSelector).attr("href") !== "" };
    }

    async getPopular(page) {
        return this.parseList(await this.page(`${this.source.baseUrl}/anime?page=${page}&sub=&order=popular`), "a.r");
    }

    async getLatestUpdates(page) {
        return this.parseList(await this.page(`${this.source.baseUrl}/anime?page=${page}&sub=&order=update`), "a.r");
    }

    async search(query, page, filters) {
        return this.parseList(await this.page(`${this.source.baseUrl}${page > 1 ? `/page/${page}` : ""}/?s=${encodeURIComponent(query)}`), "a.next.page-numbers");
    }

    async getDetail(url) {
        const doc = await this.page(url);
        const info = doc.select("div.info-content > div.spe > span").map((span) => span.text.trim());
        const status = info.find((line) => line.startsWith("Status:")) || "";
        const episodes = doc.select("div.eplister > ul > li > a").map((a) => ({
            name: `Episode ${a.selectFirst("div.epl-num").text.trim()}`,
            url: a.attr("href"),
            dateUpload: parseDates([a.selectFirst("div.epl-date").text.trim()], "MMMM d, yyyy", "en")[0],
        }));
        return {
            name: doc.selectFirst("h1.entry-title").text.trim(),
            imageUrl: doc.selectFirst("div.thumb img").attr("src"),
            genre: doc.select("div.genxed > a").map((a) => a.text.trim()).filter((genre) => genre !== "MY FAVOURITE"),
            description: doc.select("div.entry-content > p").map((p) => p.text.trim()).join("\n"),
            status: status.includes("Ongoing") ? 0 : status.includes("Completed") ? 1 : 5,
            author: (info.find((line) => line.startsWith("Network:")) || "").replace("Network: ", "").replace("Donghua Stream, ", ""),
            artist: (info.find((line) => line.startsWith("Studio:")) || "").replace("Studio: ", ""),
            episodes,
        };
    }

    /** The server picker's options, either in the page or inside a base64 inline script (newer layout). */
    servers(html) {
        const doc = new Document(html);
        const options = doc.select("select.mirror > option[data-index]");
        if (options.length > 0) return options;
        const script = doc.selectFirst("article[id] > script").attr("src").replace("data:text/javascript;base64,", "");
        if (script === "") return [];
        const inline = /"html":"(.*?)","autoplayIndex"/s.exec(base64Decode(script));
        if (!inline) return [];
        const unescaped = inline[1].replaceAll("\\t", "\t").replaceAll("\\n", "\n").replaceAll('\\"', '"').replaceAll("\\/", "/");
        return new Document(unescaped).select("select.mirror > option[data-index]");
    }

    async getVideoList(url) {
        const res = await this.client.get(url);
        const videos = [];
        for (const option of this.servers(res.body)) {
            const name = `${option.attr("data-index")}: ${option.text.trim()}`;
            const iframe = new Document(base64Decode(option.attr("value"))).selectFirst("iframe").attr("src");
            try {
                if (iframe.includes("geo.dailymotion.com/player")) {
                    const id = /[?&]video=([a-zA-Z0-9]+)/.exec(iframe);
                    if (id) videos.push(...await this.dailymotion(id[1], name));
                } else if (iframe.includes("//play.streamplay.co.in/")) {
                    videos.push(...await this.streamplay(iframe.split("/embed/")[1], name));
                }
            } catch (_) {
                // One broken server shouldn't hide the others.
            }
        }
        return videos;
    }

    async dailymotion(id, name) {
        const res = await this.client.get(`https://www.dailymotion.com/player/metadata/video/${id}`);
        return this.hlsVariants(JSON.parse(res.body).qualities.auto[0].url, name, []);
    }

    async streamplay(id, name) {
        const res = await this.client.get(`https://play.streamplay.co.in/embed/${id}`);
        const packed = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[^)]*\)\)/.exec(res.body);
        if (!packed) return [];
        const kaken = /window\.kaken\s*=\s*"([^"]+)"/.exec(unpackJs(packed[0]));
        if (!kaken) return [];
        const api = JSON.parse((await this.client.get(`https://play.streamplay.co.in/api/?${kaken[1]}`)).body);
        const subtitles = (api.tracks || []).map((track) => ({ file: track.file, label: `${name} - ${track.label}` }));
        return this.hlsVariants(api.sources[0].file, name, subtitles);
    }

    /** One video per variant of an HLS master playlist, highest resolution first. */
    async hlsVariants(masterUrl, name, subtitles) {
        const master = (await this.client.get(masterUrl)).body;
        const base = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
        const tracks = [...subtitles];
        for (const match of master.matchAll(/#EXT-X-MEDIA:TYPE=SUBTITLES.*?NAME="(.*?)".*?URI="(.*?)"/g)) {
            tracks.push({ file: match[2].startsWith("http") ? match[2] : base + match[2], label: `${name} - ${match[1]}` });
        }
        const variants = master.split("#EXT-X-STREAM-INF:").slice(1).map((block) => {
            const height = Number((/RESOLUTION=\d+x(\d+)/.exec(block) || [])[1] || 0);
            const line = block.split("\n")[1].trim();
            const url = line.startsWith("http") ? line : base + line;
            return { url, originalUrl: url, quality: `${name} - ${height}p`, height };
        }).sort((a, b) => b.height - a.height);
        const videos = variants.length > 0 ? variants : [{ url: masterUrl, originalUrl: masterUrl, quality: name }];
        videos[0].subtitles = tracks;
        return videos.map(({ height, ...video }) => video);
    }
}
