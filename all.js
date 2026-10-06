// ---------- Дефолтные монеты (на случай, если watchlist пустой) ----------
const DEFAULT_COINS = [
    { symbol: "btcusdt", name: "Bitcoin", ticker: "BTC", localIcon: "Bitcoin.svg" },
    { symbol: "solusdt", name: "Solana",  ticker: "SOL", localIcon: "solana.svg" },
    { symbol: "zecusdt", name: "Zcash",   ticker: "ZEC", localIcon: "zcash.svg" },
    { symbol: "gramusdt", name: "Gram",   ticker: "GRAM", localIcon: "gram.svg" },
];

// ---------- Известные монеты ----------
const KNOWN_COINS = {
    btc:   { name: "Bitcoin",     ticker: "BTC",  localIcon: "Bitcoin.svg" },
    sol:   { name: "Solana",      ticker: "SOL",  localIcon: "solana.svg" },
    zec:   { name: "Zcash",       ticker: "ZEC",  localIcon: "zcash.svg" },
    gram:  { name: "Gram",        ticker: "GRAM", localIcon: "gram.svg" },
    eth:   { name: "Ethereum",    ticker: "ETH",  localIcon: "ethereum.svg" },
    bnb:   { name: "BNB",         ticker: "BNB",  localIcon: "binance.svg" },
    xrp:   { name: "XRP",         ticker: "XRP",  localIcon: "xrp.svg" },
    hype:  { name: "Hyperliquid", ticker: "HYPE", localIcon: "hype.svg" },
};

// ---------- Кэш пар Binance ----------
const BINANCE_SYMBOLS_KEY = "binanceSymbols";
const BINANCE_SYMBOLS_TTL = 24 * 60 * 60 * 1000;
let binanceSymbols = null;

async function loadBinanceSymbols() {
    try {
        const cached = JSON.parse(localStorage.getItem(BINANCE_SYMBOLS_KEY));
        if (cached && cached.time && (Date.now() - cached.time < BINANCE_SYMBOLS_TTL)) {
            binanceSymbols = new Set(cached.symbols);
            return;
        }
    } catch (e) {}

    try {
        const res = await fetch("https://api.binance.com/api/v3/exchangeInfo");
        const data = await res.json();
        if (!data.symbols) throw new Error("Нет данных");
        const list = data.symbols
            .filter(s => s.status === "TRADING" && s.quoteAsset === "USDT")
            .map(s => s.symbol);
        binanceSymbols = new Set(list);
        localStorage.setItem(BINANCE_SYMBOLS_KEY, JSON.stringify({ time: Date.now(), symbols: list }));
    } catch (e) {
        console.warn("Не удалось загрузить exchangeInfo:", e);
    }
}

// ---------- Watchlist ----------
let watchlist = loadWatchlist();

function loadWatchlist() {
    try {
        const saved = JSON.parse(localStorage.getItem("watchlist"));
        if (Array.isArray(saved) && saved.length) return saved;
    } catch (e) {}
    return [...DEFAULT_COINS];
}

function saveWatchlist() {
    localStorage.setItem("watchlist", JSON.stringify(watchlist));
}

// ---------- DOM ----------
const grid = document.getElementById("grid");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const lastUpdate = document.getElementById("lastUpdate");
const template = document.getElementById("cardTemplate");
const themeBtn = document.getElementById("themeBtn");
const portfolioBtn = document.getElementById("portfolioBtn");
const portfolioModal = document.getElementById("portfolioModal");
const portfolioClose = document.getElementById("portfolioClose");
const portfolioList = document.getElementById("portfolioList");
const portfolioTotal = document.getElementById("portfolioTotal");
const chartModal = document.getElementById("chartModal");
const chartClose = document.getElementById("chartClose");
const chartName = document.getElementById("chartName");
const chartTicker = document.getElementById("chartTicker");
const chartContainer = document.getElementById("chartContainer");
const addModal = document.getElementById("addModal");
const addClose = document.getElementById("addClose");
const tickerInput = document.getElementById("tickerInput");
const addHint = document.getElementById("addHint");
const addConfirm = document.getElementById("addConfirm");
const addBtn = document.getElementById("addBtn");

// ---------- Состояние ----------
const cards = {};
const prevPrices = {};
const history = {};
const lastPrices = {};
let portfolio = JSON.parse(localStorage.getItem("portfolio") || "{}");

const START_DATE = new Date("2026-06-01T00:00:00Z");

// ============================================================
//  🌗 ТЕМА
// ============================================================
function applyTheme(theme) {
    if (theme === "light") {
        document.body.classList.add("light");
        themeBtn.textContent = "☀️";
    } else {
        document.body.classList.remove("light");
        themeBtn.textContent = "🌙";
    }
}

function initTheme() {
    const saved = localStorage.getItem("theme") || "dark";
    applyTheme(saved);
    themeBtn.addEventListener("click", () => {
        const next = document.body.classList.contains("light") ? "dark" : "light";
        localStorage.setItem("theme", next);
        applyTheme(next);
        if (chartModal.classList.contains("open")) {
            renderChart(currentChartSymbol, currentChartInterval);
        }
    });
}

// ============================================================
//  📊 РЕКОМЕНДАТЕЛЬНАЯ СИСТЕМА
// ============================================================
let ratingsCache = JSON.parse(localStorage.getItem("ratingsCache") || "{}");
const RATING_TTL = 60 * 60 * 1000; // 1 час

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calcMA(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
}

async function calcRating(symbol) {
    const cached = ratingsCache[symbol];
    if (cached && (Date.now() - cached.timestamp < RATING_TTL)) {
        return cached;
    }

    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1d&limit=250`;
        const res = await fetch(url);
        const raw = await res.json();

        if (!Array.isArray(raw) || raw.length < 50) {
            const result = { rating: "neutral", level: 0, reason: "Недостаточно данных", timestamp: Date.now() };
            ratingsCache[symbol] = result;
            localStorage.setItem("ratingsCache", JSON.stringify(ratingsCache));
            return result;
        }

        const closes = raw.map(k => parseFloat(k[4]));
        const currentPrice = closes[closes.length - 1];

        const rsi = calcRSI(closes, 14);
        const ma50 = calcMA(closes, 50);
        const ma200 = calcMA(closes, 200);

        let score = 0;
        const signals = [];

        if (rsi !== null) {
            if (rsi < 30) { score += 1; signals.push(`RSI ${rsi.toFixed(1)} → перепродан`); }
            else if (rsi > 70) { score -= 1; signals.push(`RSI ${rsi.toFixed(1)} → перекуплен`); }
            else signals.push(`RSI ${rsi.toFixed(1)} → нейтрально`);
        }

        if (ma50 !== null) {
            if (currentPrice > ma50) { score += 1; signals.push(`Цена > MA50`); }
            else { score -= 1; signals.push(`Цена < MA50`); }
        }

        if (ma200 !== null) {
            if (currentPrice > ma200) { score += 1; signals.push(`Цена > MA200`); }
            else { score -= 1; signals.push(`Цена < MA200`); }
        }

        let rating, level;
        if (score >= 3) { rating = "strong_buy"; level = 2; }
        else if (score >= 1) { rating = "buy"; level = 1; }
        else if (score <= -3) { rating = "strong_sell"; level = -2; }
        else if (score <= -1) { rating = "sell"; level = -1; }
        else { rating = "neutral"; level = 0; }

        const result = { rating, level, score, signals, rsi, ma50, ma200, currentPrice, timestamp: Date.now() };
        ratingsCache[symbol] = result;
        localStorage.setItem("ratingsCache", JSON.stringify(ratingsCache));
        return result;
    } catch (e) {
        console.warn(`Не удалось посчитать рейтинг для ${symbol}:`, e);
        return { rating: "neutral", level: 0, reason: "Ошибка загрузки", timestamp: Date.now() };
    }
}

// ★ Отрисовка бейджа рейтинга (текстовый формат)
function renderRatingBadge(container, ratingData) {
    if (!container) return;
    const { rating } = ratingData;

    let text, cls;
    if (rating === "strong_buy") { text = "Активно покупать"; cls = "rating-strong-buy"; }
    else if (rating === "buy") { text = "Покупать"; cls = "rating-buy"; }
    else if (rating === "strong_sell") { text = "Активно продавать"; cls = "rating-strong-sell"; }
    else if (rating === "sell") { text = "Продавать"; cls = "rating-sell"; }
    else { text = "Нейтрально"; cls = "rating-neutral"; }

    container.innerHTML = `
        <span class="rating-label">Тех. анализ:</span>
        <span class="rating-text">${text}</span>
    `;
    container.className = "rating-badge " + cls;
}

// ============================================================
//  🃏 КАРТОЧКИ
// ============================================================
function getIconHTML(coin) {
    if (coin.customIcon) return `<img src="${coin.customIcon}" alt="${coin.name}">`;
    if (coin.localIcon) return `<img src="${coin.localIcon}" alt="${coin.name}">`;
    return `<span class="icon-fallback">${coin.ticker.slice(0, 3)}</span>`;
}

function createCard(coin) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".card");

    card.querySelector(".coin-icon").innerHTML = getIconHTML(coin);
    card.querySelector(".coin-name").textContent = coin.name;
    card.querySelector(".coin-symbol").textContent = coin.ticker + " / USDT";

    card.addEventListener("click", (e) => {
        if (e.target.closest(".card-remove")) return;
        openChart(coin);
    });

    const removeBtn = card.querySelector(".card-remove");
    removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeCoin(coin.symbol);
    });

    cards[coin.symbol] = {
        card,
        price: card.querySelector(".price"),
        change: card.querySelector(".change-badge"),
        high: card.querySelector(".high"),
        low: card.querySelector(".low"),
        volume: card.querySelector(".volume"),
        spark: card.querySelector(".spark-line"),
    };

    history[coin.symbol] = history[coin.symbol] || [];

    // ★ Расчёт рейтинга
    const ratingEl = card.querySelector(".rating-badge");
    if (ratingEl) {
        ratingEl.dataset.symbol = coin.symbol;
        calcRating(coin.symbol).then((data) => {
            renderRatingBadge(ratingEl, data);
        });
    }

    return node;
}

function renderWatchlist() {
    grid.innerHTML = "";
    Object.keys(cards).forEach((k) => delete cards[k]);

    if (!watchlist.length) {
        grid.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:40px 0;">Список пуст. Добавь токены.</p>`;
    } else {
        watchlist.forEach((coin) => grid.appendChild(createCard(coin)));
    }

    reconnectWebSocket();
    renderPortfolioValues();
}

function removeCoin(symbol) {
    if (watchlist.length <= 1) return;
    watchlist = watchlist.filter((c) => c.symbol !== symbol);
    saveWatchlist();
    renderWatchlist();
}

// ============================================================
//  ➕ ДОБАВЛЕНИЕ
// ============================================================
function openAddModal() {
    addModal.classList.add("open");
    document.body.style.overflow = "hidden";
    tickerInput.value = "";
    addHint.textContent = "Введи тикер — проверим по списку Binance.";
    addHint.className = "add-hint";
    setTimeout(() => tickerInput.focus(), 100);
}

function closeAddModal() {
    addModal.classList.remove("open");
    document.body.style.overflow = "";
}

function addCoin() {
    const raw = tickerInput.value.trim().toUpperCase();
    if (!raw) { setHint("Введи тикер", "error"); return; }

    const symbol = raw.toLowerCase() + "usdt";

    if (watchlist.some((c) => c.symbol === symbol)) {
        setHint("Эта монета уже в списке", "error"); return;
    }

    if (!binanceSymbols) {
        setHint("Список Binance ещё не загружен. Подожди пару секунд.", "error"); return;
    }

    if (!binanceSymbols.has(raw + "USDT")) {
        setHint(`Пары ${raw}USDT нет на Binance`, "error"); return;
    }

    const known = KNOWN_COINS[raw.toLowerCase()];
    let coin;
    if (known) {
        coin = { symbol, name: known.name, ticker: known.ticker };
        if (known.customIcon) coin.customIcon = known.customIcon;
        if (known.localIcon) coin.localIcon = known.localIcon;
    } else {
        coin = { symbol, name: raw, ticker: raw, localIcon: null };
    }

    watchlist.push(coin);
    saveWatchlist();
    setHint(`Добавлено: ${coin.name}`, "success");

    setTimeout(() => {
        closeAddModal();
        renderWatchlist();
    }, 500);
}

function setHint(text, cls) {
    addHint.textContent = text;
    addHint.className = "add-hint" + (cls ? " " + cls : "");
}

if (addBtn) {
    addBtn.addEventListener("click", openAddModal);
}
addClose.addEventListener("click", closeAddModal);
addModal.addEventListener("click", (e) => { if (e.target === addModal) closeAddModal(); });
addConfirm.addEventListener("click", addCoin);
tickerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addCoin(); });

// ============================================================
//  📊 ФОРМАТИРОВАНИЕ
// ============================================================
function formatPrice(value) {
    if (value >= 1000) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (value >= 1) return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function formatVolume(value) {
    if (value >= 1e9) return (value / 1e9).toFixed(2) + "B";
    if (value >= 1e6) return (value / 1e6).toFixed(2) + "M";
    if (value >= 1e3) return (value / 1e3).toFixed(2) + "K";
    return value.toFixed(2);
}

function updateCard(symbol, data) {
    const refs = cards[symbol];
    if (!refs) return;

    const price = parseFloat(data.c);
    const change = parseFloat(data.P);
    const high = parseFloat(data.h);
    const low = parseFloat(data.l);
    const volume = parseFloat(data.q);

    lastPrices[symbol] = price;
    refs.price.textContent = formatPrice(price);

    const prev = prevPrices[symbol];
    if (prev !== undefined && prev !== price) {
        const cls = price > prev ? "flash-up" : "flash-down";
        refs.price.classList.remove("flash-up", "flash-down");
        void refs.price.offsetWidth;
        refs.price.classList.add(cls);
        setTimeout(() => refs.price.classList.remove(cls), 400);
    }
    prevPrices[symbol] = price;

    refs.change.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
    refs.change.classList.remove("up", "down");
    if (change > 0) refs.change.classList.add("up");
    else if (change < 0) refs.change.classList.add("down");

    refs.high.textContent = formatPrice(high);
    refs.low.textContent = formatPrice(low);
    refs.volume.textContent = "$" + formatVolume(volume);

    history[symbol].push(price);
    if (history[symbol].length > 30) history[symbol].shift();
    drawSparkline(refs.spark, history[symbol], change >= 0);

    renderPortfolioValues();
}

function drawSparkline(polyline, values, isUp) {
    if (values.length < 2) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const points = values.map((v, i) => {
        const x = (i / (values.length - 1)) * 100;
        const y = 28 - ((v - min) / range) * 26;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");

    polyline.setAttribute("points", points);
    polyline.style.stroke = isUp ? "var(--green)" : "var(--red)";
}

// ============================================================
//  📊 ГРАФИК
// ============================================================
let chartInstance = null;
let candleSeries = null;
let currentChartSymbol = null;
let currentChartInterval = "1h";

async function openChart(coin) {
    currentChartSymbol = coin.symbol;
    chartName.textContent = coin.name;
    chartTicker.textContent = coin.ticker + " / USDT";
    chartModal.classList.add("open");
    document.body.style.overflow = "hidden";

    document.querySelectorAll(".chart-tabs .tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.interval === currentChartInterval);
    });

    await renderChart(coin.symbol, currentChartInterval);
}

async function renderChart(symbol, interval) {
    currentChartSymbol = symbol;
    currentChartInterval = interval;

    if (!chartInstance) {
        chartInstance = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: 400,
            layout: {
                background: { color: "transparent" },
                textColor: getComputedStyle(document.body).getPropertyValue("--text-muted").trim() || "#6b7280",
            },
            grid: {
                vertLines: { color: "rgba(128,128,128,0.08)" },
                horzLines: { color: "rgba(128,128,128,0.08)" },
            },
            timeScale: { timeVisible: true, secondsVisible: false },
            rightPriceScale: { borderVisible: false },
        });

        candleSeries = chartInstance.addCandlestickSeries({
            upColor: "#10b981", downColor: "#ef4444",
            borderUpColor: "#10b981", borderDownColor: "#ef4444",
            wickUpColor: "#10b981", wickDownColor: "#ef4444",
        });

        window.addEventListener("resize", () => {
            if (chartInstance && chartModal.classList.contains("open")) {
                chartInstance.applyOptions({ width: chartContainer.clientWidth });
            }
        });
    }

    candleSeries.setData([]);

    const startTime = Math.floor(START_DATE.getTime() / 1000);
    const endTime = Math.floor(Date.now() / 1000);

    try {
        let allCandles = [];
        let cursor = startTime;
        while (cursor < endTime) {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&startTime=${cursor * 1000}&limit=1000`;
            const res = await fetch(url);
            const raw = await res.json();
            if (!Array.isArray(raw) || !raw.length) break;
            const parsed = raw.map((k) => ({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(k[1]), high: parseFloat(k[2]),
                low: parseFloat(k[3]), close: parseFloat(k[4]),
            }));
            allCandles = allCandles.concat(parsed);
            const lastTime = parsed[parsed.length - 1].time;
            if (lastTime <= cursor) break;
            cursor = lastTime + 1;
            if (allCandles.length > 20000) break;
        }
        candleSeries.setData(allCandles);
        chartInstance.timeScale().fitContent();
    } catch (e) {
        console.error("Не удалось загрузить свечи:", e);
    }
}

document.querySelectorAll(".chart-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
        document.querySelectorAll(".chart-tabs .tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        currentChartInterval = tab.dataset.interval;
        await renderChart(currentChartSymbol, currentChartInterval);
    });
});

function closeChart() {
    chartModal.classList.remove("open");
    document.body.style.overflow = "";
}

chartClose.addEventListener("click", closeChart);
chartModal.addEventListener("click", (e) => { if (e.target === chartModal) closeChart(); });

// ============================================================
//  💼 ПОРТФЕЛЬ
// ============================================================
function buildPortfolio() {
    portfolioList.innerHTML = "";
    watchlist.forEach((coin) => {
        const item = document.createElement("div");
        item.className = "portfolio-item";
        const iconHTML = getIconHTML(coin);
        const value = portfolio[coin.symbol] || "";
        item.innerHTML = `
            <div class="coin-icon">${iconHTML}</div>
            <div class="portfolio-info">
                <div class="portfolio-name">${coin.name}</div>
                <div class="portfolio-ticker">${coin.ticker}</div>
            </div>
            <input class="portfolio-input" type="number" min="0" step="any"
                placeholder="0" data-symbol="${coin.symbol}" value="${value}" />
            <div class="portfolio-value" data-symbol="${coin.symbol}">$0.00</div>
        `;
        const input = item.querySelector(".portfolio-input");
        input.addEventListener("input", (e) => {
            const amount = parseFloat(e.target.value) || 0;
            if (amount > 0) portfolio[coin.symbol] = amount;
            else delete portfolio[coin.symbol];
            localStorage.setItem("portfolio", JSON.stringify(portfolio));
            renderPortfolioValues();
        });
        portfolioList.appendChild(item);
    });
    renderPortfolioValues();
}

function renderPortfolioValues() {
    let total = 0;
    watchlist.forEach((coin) => {
        const amount = portfolio[coin.symbol] || 0;
        const price = lastPrices[coin.symbol] || 0;
        const value = amount * price;
        const el = portfolioList.querySelector(`.portfolio-value[data-symbol="${coin.symbol}"]`);
        if (el) {
            el.textContent = "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            el.style.color = amount > 0 ? "var(--text)" : "var(--text-muted)";
        }
        total += value;
    });
    portfolioTotal.textContent = "$" + total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function openPortfolio() {
    portfolioModal.classList.add("open");
    document.body.style.overflow = "hidden";
    buildPortfolio();
}

function closePortfolio() {
    portfolioModal.classList.remove("open");
    document.body.style.overflow = "";
}

portfolioBtn.addEventListener("click", openPortfolio);
portfolioClose.addEventListener("click", closePortfolio);
portfolioModal.addEventListener("click", (e) => { if (e.target === portfolioModal) closePortfolio(); });

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (chartModal.classList.contains("open")) closeChart();
        if (portfolioModal.classList.contains("open")) closePortfolio();
        if (addModal.classList.contains("open")) closeAddModal();
    }
});

// ============================================================
//  🔌 WEBSOCKET
// ============================================================
let ws = null;
let reconnectTimer = null;

function reconnectWebSocket() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    connect();
}

function connect() {
    if (!watchlist.length) return;
    const streams = watchlist.map((c) => `${c.symbol}@ticker`).join("/");
    ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    ws.onopen = () => {
        statusDot.classList.add("live");
        statusDot.classList.remove("error");
        statusText.textContent = "В эфире";
        if (reconnectTimer) clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const stream = msg.stream || "";
        const symbol = stream.split("@")[0];
        if (msg.data) updateCard(symbol, msg.data);
        lastUpdate.textContent = "Обновлено " + new Date().toLocaleTimeString("ru-RU");
    };

    ws.onerror = () => {
        statusDot.classList.remove("live");
        statusDot.classList.add("error");
        statusText.textContent = "Ошибка соединения";
    };

    ws.onclose = () => {
        statusDot.classList.remove("live");
        statusDot.classList.add("error");
        statusText.textContent = "Переподключение…";
        reconnectTimer = setTimeout(connect, 3000);
    };
}

// ============================================================
//  🚀 ЗАПУСК
// ============================================================
initTheme();
renderWatchlist();
loadBinanceSymbols();