// Split "This is" into letters so each can drop in on its own delay. Without JS the plain text stays.
const intro = document.getElementById("intro");
const text = intro.textContent.trim();
const stagger = 0.07;

intro.setAttribute("aria-label", text);
intro.textContent = "";

let index = 0;
for (const char of text) {
    if (char === " ") {
        const space = document.createElement("span");
        space.className = "space";
        space.setAttribute("aria-hidden", "true");
        intro.appendChild(space);
        continue;
    }

    const letter = document.createElement("span");
    letter.className = "letter";
    letter.setAttribute("aria-hidden", "true");

    const inner = document.createElement("span");
    inner.textContent = char;
    inner.style.animationDelay = `${(index * stagger).toFixed(2)}s`;

    letter.appendChild(inner);
    intro.appendChild(letter);
    index += 1;
}

// The API key lives in the Cloudflare Worker behind LASTFM_PROXY. LASTFM_USER only builds profile links.
const LASTFM_PROXY = "https://lastfm-personal-site.mynamesplayer.workers.dev/";
const LASTFM_USER = "splayer_";

const lastfmRoot = document.getElementById("lastfm");
// Last.fm returns this star placeholder when a release has no artwork.
const LASTFM_NO_ART = "2a96cbd8b46e442fc41c2b86b821562f";

function lastfmUrl(method, params = {}) {
    const url = new URL(LASTFM_PROXY);
    url.searchParams.set("method", method);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
}

async function lastfmGet(method, params) {
    const res = await fetch(lastfmUrl(method, params));
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`${method}: ${data.message}`);
    return data;
}

function artworkUrl(images, size = "extralarge") {
    if (!Array.isArray(images)) return "";
    const match = images.find((img) => img.size === size) || images[images.length - 1];
    const url = match ? match["#text"] : "";
    return url && !url.includes(LASTFM_NO_ART) ? url : "";
}

function timeAgo(unixSeconds) {
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
    if (diff < 60) return "just now";
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "text") node.textContent = v;
        else node.setAttribute(k, v);
    }
    for (const child of children) node.appendChild(child);
    return node;
}

// order restarts per block so delays don't grow across the whole section.
function staggered(node, order) {
    node.classList.add("lf-item");
    node.style.setProperty("--i", String(order));
    return node;
}

function renderState(message, linkText, linkHref) {
    lastfmRoot.replaceChildren();
    const p = el("p", { class: "lastfm-state", text: message });
    if (linkText && linkHref) {
        p.appendChild(document.createTextNode(" "));
        p.appendChild(el("a", { href: linkHref, text: linkText }));
    }
    lastfmRoot.appendChild(staggered(p, 0));
    watchReveal(p);
}

function renderNow(track) {
    const playing = track["@attr"] && track["@attr"].nowplaying === "true";
    const status = playing ? "Now playing" : `Last played, ${timeAgo(Number(track.date.uts))}`;
    const art = artworkUrl(track.image);

    const artNode = art
        ? el("img", { class: "now-art", src: art, alt: `${track.album["#text"] || track.name} cover`, loading: "lazy" })
        : el("div", { class: "now-art-empty", "aria-hidden": "true" });

    const text = el("div", {}, [
        el("p", { class: "now-status", text: status }),
        el("h2", { class: "now-track" }, [el("a", { href: track.url, text: track.name })]),
        el("p", { class: "now-artist", text: track.artist["#text"] }),
    ]);

    return el("div", { class: "now" }, [staggered(artNode, 0), staggered(text, 1)]);
}

function renderArtists(artists) {
    const items = artists.map((a, i) =>
        staggered(el("li", {}, [
            el("a", { href: a.url, text: a.name }),
            el("span", { class: "plays", text: `${Number(a.playcount).toLocaleString()} plays` }),
        ]), i + 1)
    );
    return el("div", {}, [
        staggered(el("p", { class: "lastfm-heading", text: "Top artists this week" }), 0),
        el("ol", { class: "artists" }, items),
    ]);
}

function renderTotal(info) {
    const count = Number(info.playcount);
    const since = new Date(Number(info.registered.unixtime) * 1000).getFullYear();
    return el("div", {}, [
        staggered(el("p", { class: "lastfm-heading", text: "In total" }), 0),
        staggered(el("p", { class: "scrobbles", text: count.toLocaleString() }), 2),
        staggered(el("p", { class: "scrobbles-caption", text: `scrobbles since ${since}` }), 3),
    ]);
}

function renderAlbums(albums) {
    const items = albums.map((album, i) => {
        const art = artworkUrl(album.image);
        const label = `${album.name} by ${album.artist.name}, ${Number(album.playcount).toLocaleString()} plays`;
        const inner = art
            ? el("img", { src: art, alt: label, loading: "lazy" })
            : el("span", { class: "album-empty", role: "img", "aria-label": label });
        return staggered(el("li", {}, [el("a", { href: album.url, title: label }, [inner])]), i + 1);
    });
    return el("div", {}, [
        staggered(el("p", { class: "lastfm-heading", text: "Top albums this month" }), 0),
        el("ul", { class: "albums" }, items),
    ]);
}

async function loadLastfm() {
    if (!lastfmRoot) return;

    if (!LASTFM_PROXY) {
        renderState("Last.fm isn't connected yet.");
        return;
    }

    const profile = `https://www.last.fm/user/${encodeURIComponent(LASTFM_USER)}`;

    const [recent, artists, info, albums] = await Promise.allSettled([
        lastfmGet("user.getRecentTracks", { limit: 1 }),
        lastfmGet("user.getTopArtists", { period: "7day", limit: 5 }),
        lastfmGet("user.getInfo"),
        lastfmGet("user.getTopAlbums", { period: "1month", limit: 6 }),
    ]);

    const settled = [recent, artists, info, albums];
    if (settled.every((r) => r.status === "rejected")) {
        console.error(settled.map((r) => r.reason));
        renderState("Last.fm isn't answering right now.", "Open the profile instead.", profile);
        return;
    }

    const blocks = [];

    const track = recent.status === "fulfilled" && recent.value.recenttracks.track[0];
    if (track) blocks.push(renderNow(track));

    const grid = [];
    const artistList = artists.status === "fulfilled" ? artists.value.topartists.artist : [];
    if (artistList.length) grid.push(renderArtists(artistList));
    if (info.status === "fulfilled") grid.push(renderTotal(info.value.user));
    if (grid.length) blocks.push(el("div", { class: "lastfm-grid" }, grid));

    const albumList = albums.status === "fulfilled" ? albums.value.topalbums.album : [];
    if (albumList.length) blocks.push(renderAlbums(albumList));

    if (!blocks.length) {
        renderState("Nothing scrobbled yet.", "See the profile.", profile);
        return;
    }

    lastfmRoot.replaceChildren(...blocks);
    for (const node of lastfmRoot.querySelectorAll(".lf-item")) watchReveal(node);
}

// Shared observer: Last.fm nodes arrive after load and register themselves via watchReveal.
const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add("in-view");
                revealObserver.unobserve(entry.target);
            }
        }
    }, { threshold: 0.2 })
    : null;

function watchReveal(node) {
    if (revealObserver) revealObserver.observe(node);
    else node.classList.add("in-view");
}

for (const node of document.querySelectorAll(".reveal, .lf-item")) watchReveal(node);

// Public-domain translations: Long (Marcus Aurelius), Carter (Epictetus), Gummere (Seneca).
const QUOTES = [
    { text: "Some things are in our control and others not.", author: "Epictetus", work: "Enchiridion", ref: "1" },
    { text: "Men are disturbed, not by things, but by the principles and notions which they form concerning things.", author: "Epictetus", work: "Enchiridion", ref: "5" },
    { text: "The best way of avenging yourself is not to become like the wrongdoer.", author: "Marcus Aurelius", work: "Meditations", ref: "6.6" },
    { text: "Look within. Within is the fountain of good, and it will ever bubble up, if you will ever dig.", author: "Marcus Aurelius", work: "Meditations", ref: "7.59" },
    { text: "Such as your habitual thoughts are, such also will be the character of your mind; for the soul is dyed by the thoughts.", author: "Marcus Aurelius", work: "Meditations", ref: "5.16" },
    { text: "Do not act as if you were going to live ten thousand years. Death hangs over you. While you live, while it is in your power, be good.", author: "Marcus Aurelius", work: "Meditations", ref: "4.17" },
    { text: "While we are postponing, life speeds by.", author: "Seneca", work: "Letters to Lucilius", ref: "1" },
    { text: "We suffer more often in imagination than in reality.", author: "Seneca", work: "Letters to Lucilius", ref: "13" },
];

function showQuote() {
    const block = document.getElementById("quote");
    if (!block) return;

    let last = -1;
    try { last = Number(localStorage.getItem("quote")); } catch { /* storage blocked */ }

    let index = Math.floor(Math.random() * QUOTES.length);
    if (index === last) index = (index + 1) % QUOTES.length;
    try { localStorage.setItem("quote", String(index)); } catch { /* storage blocked */ }

    const q = QUOTES[index];
    const cite = el("cite", { text: q.work });
    const source = el("footer", { text: `${q.author}, ` }, [cite]);
    source.appendChild(document.createTextNode(` ${q.ref}`));
    block.replaceChildren(el("p", { text: q.text }), source);
}

showQuote();
loadLastfm();
