const mangayomiSources = [{
    "name": "Anime-Sama",
    "lang": "fr",
    "baseUrl": "https://anime-sama.to",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/QuillDev/mangayomi-extensions/main/javascript/icon/fr.animesama.png",
    "typeSource": "single",
    "isManga": false,
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/fr/animesama.js"
}];

const VOICES = ["vostfr", "vf", "vf1", "vf2", "va", "var", "vcn", "vj", "vkr", "vqc"];
const VIDHIDE_DOMAINS = ["smoothpre", "movearnpre", "minochinos", "morencius", "vidhide"];
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get baseUrl() {
        const pref = (new SharedPreferences().get("base_url_pref") || "https://anime-sama.to").trim();
        return pref.endsWith("/") ? pref.slice(0, -1) : pref;
    }

    absolute(href) {
        return href.startsWith("http") ? href : this.baseUrl + href;
    }

    async getPopular(page) {
        const doc = new Document((await this.client.get(`${this.baseUrl}/`)).body);
        const links = doc.select("#containerPepites > div a");
        const chunk = links.slice((page - 1) * 5, page * 5);
        const seasons = [];
        for (const link of chunk) seasons.push(...await this.seasons(this.absolute(link.attr("href")), ""));
        return { list: seasons, hasNextPage: page * 5 < links.length };
    }

    async getLatestUpdates(page) {
        const doc = new Document((await this.client.get(this.baseUrl)).body);
        const seen = new Set();
        const seasons = [];
        for (const card of doc.select("#containerAjoutsAnimes > div")) {
            const href = this.absolute(card.selectFirst("a").attr("href"));
            if (href === this.baseUrl) continue;
            const parts = href.substringAfter("://").split("/").filter((part) => part !== "");
            const show = parts.length >= 4 ? `https://${parts.slice(0, parts.length - 2).join("/")}` : href;
            if (seen.has(show)) continue;
            seen.add(show);
            seasons.push(...await this.seasons(show, ""));
        }
        return { list: seasons, hasNextPage: false };
    }

    async search(query, page, filters) {
        const text = query.trim();
        if (text.startsWith("https://")) return { list: await this.seasons(text, ""), hasNextPage: false };
        let url = `${this.baseUrl}/catalogue/?search=${encodeURIComponent(text)}&page=${page}`;
        for (const filter of filters || []) {
            const value = filter.values && filter.values[filter.state] ? filter.values[filter.state].value : "";
            if (value !== "" && filter.type === "TypeFilter") url += `&type[]=${encodeURIComponent(value)}`;
            if (value !== "" && filter.type === "LanguageFilter") url += `&langue[]=${encodeURIComponent(value)}`;
        }
        const doc = new Document((await this.client.get(url)).body);
        const seasons = [];
        for (const link of doc.select("#list_catalog > div a")) seasons.push(...await this.seasons(this.absolute(link.attr("href")), ""));
        const last = doc.selectFirst("#list_pagination a:last-child").text.trim();
        return { list: seasons, hasNextPage: last !== "" && last !== String(page) };
    }

    /** One result per season (or film) of a show, read from the show page's panneauAnime() calls. */
    async seasons(showUrl, onlySeason) {
        const clean = showUrl.replace(/\/+$/, "");
        const html = (await this.client.get(clean)).body;
        const doc = new Document(html);
        const name = doc.selectFirst("h1").text.trim();
        const statusText = doc.select(".info-lbl").filter((label) => label.text.includes("État")).map((label) => label.nextElementSibling.text).join(" ").toLowerCase();
        const status = statusText.includes("en cours") ? 0 : statusText.includes("terminé") ? 1 : 5;
        const imageUrl = doc.selectFirst("#coverOeuvre").attr("src") || doc.selectFirst("meta[property=og:image]").attr("content");
        const description = doc.selectFirst("#synopsisText").text.trim();
        const genre = doc.select(".genre-pill").map((pill) => pill.text.trim()).filter((pill) => pill !== "");
        const base = { imageUrl, description, genre, status };
        const scripts = doc.select("script").map((script) => script.text).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
        const list = [];
        for (const match of scripts.matchAll(/panneauAnime\(\s*["']([^"']*)["']\s*,\s*["']([^"']*)["']\s*\)/g)) {
            const [, seasonName, stem] = match;
            const season = stem.split("/")[0];
            if (onlySeason !== "" && season !== onlySeason) continue;
            if (stem.toLowerCase().includes("film")) {
                const players = await this.players(`${clean}/${stem}`);
                const titles = [...html.matchAll(/newSPF\(\s*["']([^"']*)["']\s*\);/g)].map((m) => m[1]);
                players.forEach((_, index) => {
                    const title = titles[index] ? `${name} ${titles[index]}` : players.length === 1 ? `${name} Film` : `${name} Film ${index + 1}`;
                    list.push({ ...base, name: title, link: `${clean}/${stem}#${index}` });
                });
            } else {
                const label = season.startsWith("saison") ? `Saison ${season.replace("saison", "")}` : seasonName.split(" (")[0];
                list.push({ ...base, name: `${name} ${label}`.trim(), link: `${clean}/${stem}` });
            }
        }
        if (list.length === 0 && name !== "") list.push({ ...base, name, link: clean });
        return list;
    }

    /** A voice folder's episodes.js: one array of player links per host, index = episode. */
    async players(folderUrl) {
        try {
            const folder = folderUrl.replace(/\/+$/, "");
            // The site answers 403 without the folder page as Referer.
            const res = await this.client.get(`${folder}/episodes.js`, { Referer: `${folder}/` });
            if (res.statusCode !== 200 || !res.body.includes("eps")) return [];
            const lists = [];
            for (const match of res.body.matchAll(/(?:var|let|const)?\s*(eps\w*)\s*=\s*\[([\s\S]*?)\];/g)) {
                const urls = [...match[2].matchAll(/['"](https?:\/\/[^'"\s]+)['"]/g)].map((m) => m[1]);
                if (urls.length > 0) lists.push(urls);
            }
            return lists;
        } catch (_) {
            return [];
        }
    }

    async getDetail(url) {
        const clean = url.replace(/\/+$/, "");
        const [target, movieIndex] = clean.split("#");
        const parts = target.replace(this.baseUrl, "").split("/").filter((part) => part !== "");
        const showUrl = `${this.baseUrl}/${parts.slice(0, 2).join("/")}`;
        const seasons = await this.seasons(showUrl, parts[2] || "");
        const index = movieIndex === undefined ? 0 : Number(movieIndex);
        const detail = seasons[index] || seasons[0] || { name: "", link: url };

        const folder = target.split("/").pop();
        const parent = VOICES.includes(folder) ? target.substring(0, target.lastIndexOf("/")) : target;
        const voices = [];
        for (const voice of [...new Set([folder, ...VOICES])]) {
            const players = await this.players(`${parent}/${voice}`);
            if (players.length > 0) voices.push({ voice, players });
        }
        const count = Math.max(0, ...voices.flatMap(({ players }) => players.map((list) => list.length)));
        const episodes = [];
        for (let i = 0; i < count; i++) {
            const available = voices
                .map(({ voice, players }) => ({ voice, links: players.map((list) => list[i]).filter((link) => link) }))
                .filter(({ links }) => links.length > 0);
            if (movieIndex !== undefined && i !== index) continue;
            episodes.push({
                name: movieIndex === undefined ? `Episode ${i + 1}` : detail.name,
                url: JSON.stringify(available),
                scanlator: available.map(({ voice }) => voice).join(", ").toUpperCase(),
            });
        }
        return { ...detail, episodes: episodes.reverse() };
    }

    async getVideoList(url) {
        let groups = [];
        try {
            groups = JSON.parse(url);
        } catch (_) {
            groups = [];
        }
        const videos = [];
        for (const { voice, links } of groups) {
            for (const link of links) {
                try {
                    for (const video of await this.extract(link)) videos.push({ ...video, quality: `${voice.toUpperCase()} ${video.quality}` });
                } catch (_) {
                    // A dead host shouldn't hide the others.
                }
            }
        }
        const seen = new Set();
        return this.sortVideos(videos.filter((video) => !seen.has(video.url.split("?")[0]) && seen.add(video.url.split("?")[0])));
    }

    extract(link) {
        const lower = link.toLowerCase();
        if (lower.includes("sibnet.ru")) return this.sibnet(link);
        if (lower.includes("vidmoly") || lower.includes("ansembed")) return this.vidmoly(link);
        if (lower.includes("sendvid.com")) return this.sendvid(link);
        if (VIDHIDE_DOMAINS.some((domain) => lower.includes(domain))) return this.vidhide(link);
        if (lower.includes("vk.com") || lower.includes("vkvideo")) return this.vk(link);
        if (lower.includes("uqload")) return this.uqload(link);
        if (lower.includes("yourupload")) return this.yourupload(link);
        if (lower.includes(".mp4")) return [{ url: link, originalUrl: link, quality: "Direct MP4", headers: { Referer: this.baseUrl } }];
        return [];
    }

    video(url, quality, headers) {
        return { url, originalUrl: url, quality, headers };
    }

    async sibnet(url) {
        const html = (await this.client.get(url, { Referer: this.baseUrl })).body;
        const match = /player\.src\s*\(?\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/.exec(html) || /["'](\/(?:v|shell)\/[^"']+\.mp4)["']/.exec(html);
        if (!match) return [];
        const video = match[1].startsWith("http") ? match[1] : `https://${url.substringAfter("://").substringBefore("/")}${match[1]}`;
        return [this.video(video, "Sibnet", { Referer: url })];
    }

    async vidmoly(url) {
        const base = "https://vidmoly.biz";
        const fixed = url.startsWith(base) ? url : url.replace(/^https?:\/\/(?:www\.)?[^/]+\//, `${base}/`);
        const headers = { Origin: base, Referer: `${base}/`, "User-Agent": BROWSER };
        const match = /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/.exec((await this.client.get(fixed, headers)).body);
        return match ? [this.video(match[1], "VidMoly - 1080p", headers)] : [];
    }

    async sendvid(url) {
        const master = new Document((await this.client.get(url)).body).selectFirst("source#video_source").attr("src");
        if (master === "") return [];
        const origin = `https://${url.substringAfter("://").substringBefore("/")}`;
        return [this.video(master, "Sendvid", { Origin: origin, Referer: `${origin}/` })];
    }

    async vidhide(url) {
        const headers = { Referer: url, "User-Agent": BROWSER };
        let html = (await this.client.get(url, headers)).body;
        if (html.includes("p,a,c,k,e,d")) html += unpackJs(html);
        const match = /["']((?:https?:\/)?\/[^"']*m3u8[^"']*)["']/.exec(html);
        if (!match) return [];
        const video = match[1].startsWith("http") ? match[1] : `https://${url.substringAfter("://").substringBefore("/")}${match[1]}`;
        return [this.video(video, "VidHide - 1080p", headers)];
    }

    async vk(url) {
        const headers = { Origin: "https://vk.com", Referer: "https://vk.com/", "User-Agent": BROWSER };
        const html = (await this.client.get(url, headers)).body;
        return [...html.matchAll(/url(\d+)["']:\s*["'](https?:[^"']+)["']/g)]
            .map((m) => this.video(m[2].replaceAll("\\/", "/"), `VK ${m[1]}p`, headers))
            .sort((a, b) => Number(b.quality.replace(/\D/g, "")) - Number(a.quality.replace(/\D/g, "")));
    }

    async uqload(url) {
        const fixed = url.replace(/^https?:\/\/(?:www\.)?[^/]+\//, "https://uqload.is/");
        const headers = { Referer: fixed, "User-Agent": BROWSER };
        const match = /sources\s*:\s*\[\s*["'](https?:\/\/[^"']+)["']\s*\]/.exec((await this.client.get(fixed, headers)).body);
        return match ? [this.video(match[1], "Uqload", headers)] : [];
    }

    async yourupload(url) {
        const headers = { Referer: "https://www.yourupload.com/" };
        const match = /file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/.exec((await this.client.get(url, headers)).body);
        return match ? [this.video(match[1], "YourUpload", headers)] : [];
    }

    sortVideos(videos) {
        const prefs = new SharedPreferences();
        const voice = (prefs.get("voices_preference") || "vostfr").toUpperCase();
        const player = (prefs.get("player_preference") || "sibnet").toLowerCase();
        const quality = prefs.get("preferred_quality") || "1080";
        const score = (video) => (video.quality.startsWith(`${voice} `) ? 4 : 0)
            + (video.quality.toLowerCase().includes(player) ? 2 : 0) + (video.quality.includes(quality) ? 1 : 0);
        return videos.sort((a, b) => score(b) - score(a));
    }

    getSourcePreferences() {
        return [
            { key: "base_url_pref", editTextPreference: { title: "URL de base", summary: "", value: "https://anime-sama.to", dialogTitle: "URL", dialogMessage: "" } },
            { key: "preferred_quality", listPreference: { title: "Qualité préférée", summary: "", valueIndex: 0, entries: ["1080p", "720p", "480p", "360p"], entryValues: ["1080", "720", "480", "360"] } },
            { key: "voices_preference", listPreference: { title: "Préférence des voix", summary: "", valueIndex: 0, entries: VOICES.map((v) => `Préférer ${v.toUpperCase()}`), entryValues: VOICES } },
            {
                key: "player_preference",
                listPreference: {
                    title: "Lecteur par défaut", summary: "", valueIndex: 0,
                    entries: ["Sibnet", "Sendvid", "VidMoly", "VidHide", "VK", "Uqload", "YourUpload", "Direct MP4"],
                    entryValues: ["sibnet", "sendvid", "vidmoly", "vidhide", "vk", "uqload", "yourupload", "direct"],
                },
            },
        ];
    }

    getFilterList() {
        const option = (name, value) => ({ type_name: "SelectOption", name, value });
        return [
            { type_name: "SelectFilter", type: "TypeFilter", name: "Type", state: 0, values: [option("Tous", ""), option("Anime", "Anime"), option("Film", "Film")] },
            { type_name: "SelectFilter", type: "LanguageFilter", name: "Langue", state: 0, values: [option("Toutes", ""), option("VOSTFR", "vostfr"), option("VF", "vf")] },
        ];
    }
}
