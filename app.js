// ---------- Конфигурация монет ----------
const COINS = [
    { symbol: "btcusdt", name: "Bitcoin",  ticker: "BTC",  icon: "bitcoin" },
    { symbol: "solusdt", name: "Solana",   ticker: "SOL",  icon: "solana" },
    { symbol: "zecusdt", name: "Zcash",    ticker: "ZEC",  icon: "zcash" },
    { symbol: "gramusdt", name: "Gram", ticker: "GRAM", customIcon: "gram.png" },
];

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

// ★ ДОБАВЛЕНО: цена REDO в долларах
const featuredUsd = document.getElementById("featuredUsd");

// ---------- Состояние ----------
const cards = {};
const prevPrices = {};
const history = {};
const lastPrices = {};

// ★ ДОБАВЛЕНО: REDO = 777 GRAM (пересчитывается в USD по текущей цене GRAM)
const REDO_GRAM_AMOUNT = 777;

// ---------- Портфель из localStorage ----------
let portfolio = JSON.parse(localStorage.getItem("portfolio") || "{}");

// ---------- ★ Дальняя граница графика: с начала лета 2026 ----------
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
//  🃏 КАРТОЧКИ
// ============================================================
function buildCards() {
    COINS.forEach((coin) => {
        const node = template.content.cloneNode(true);
        const card = node.querySelector(".card");

        const icon = card.querySelector(".coin-icon");
        if (coin.customIcon) {
            icon.innerHTML = `<img src="${coin.customIcon}" alt="${coin.name}">`;
        } else {
            icon.innerHTML = `<i class="si si-${coin.icon} si--color"></i>`;
        }

        card.querySelector(".coin-name").textContent = coin.name;
        card.querySelector(".coin-symbol").textContent = coin.ticker + " / USDT";

        card.addEventListener("click", () => openChart(coin));

        cards[coin.symbol] = {
            card,
            price: card.querySelector(".price"),
            change: card.querySelector(".change-badge"),
            high: card.querySelector(".high"),
            low: card.querySelector(".low"),
            volume: card.querySelector(".volume"),
            spark: card.querySelector(".spark-line"),
        };

        history[coin.symbol] = [];
        grid.appendChild(node);
    });
}

// ---------- Форматирование ----------
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

// ---------- Обновление карточки ----------
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

    // ★ Пересчёт REDO в долларах по текущей цене GRAM
    if (symbol === "gramusdt" && featuredUsd) {
        const redoUsd = REDO_GRAM_AMOUNT * price;
        featuredUsd.textContent = "≈ $" + redoUsd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    renderPortfolioValues();
}

// ---------- Спарклайн ----------
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
//  📊 ГРАФИК (TradingView Lightweight Charts)
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
            upColor: "#10b981",
            downColor: "#ef4444",
            borderUpColor: "#10b981",
            borderDownColor: "#ef4444",
            wickUpColor: "#10b981",
            wickDownColor: "#ef4444",
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
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
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
chartModal.addEventListener("click", (e) => {
    if (e.target === chartModal) closeChart();
});

// ============================================================
//  💼 ПОРТФЕЛЬ
// ============================================================
function buildPortfolio() {
    portfolioList.innerHTML = "";

    COINS.forEach((coin) => {
        const item = document.createElement("div");
        item.className = "portfolio-item";

        const iconHTML = coin.customIcon
            ? `<img src="${coin.customIcon}" alt="${coin.name}">`
            : `<i class="si si-${coin.icon} si--color"></i>`;

        const value = portfolio[coin.symbol] || "";

        item.innerHTML = `
            <div class="coin-icon">${iconHTML}</div>
            <div class="portfolio-info">
                <div class="portfolio-name">${coin.name}</div>
                <div class="portfolio-ticker">${coin.ticker}</div>
            </div>
            <input
                class="portfolio-input"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                data-symbol="${coin.symbol}"
                value="${value}"
            />
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

    COINS.forEach((coin) => {
        const amount = portfolio[coin.symbol] || 0;
        const price = lastPrices[coin.symbol] || 0;
        const value = amount * price;

        const el = portfolioList.querySelector(`.portfolio-value[data-symbol="${coin.symbol}"]`);
        if (el) {
            el.textContent = "$" + value.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            el.style.color = amount > 0 ? "var(--text)" : "var(--text-muted)";
        }

        total += value;
    });

    portfolioTotal.textContent = "$" + total.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
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
portfolioModal.addEventListener("click", (e) => {
    if (e.target === portfolioModal) closePortfolio();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (chartModal.classList.contains("open")) closeChart();
        if (portfolioModal.classList.contains("open")) closePortfolio();
    }
});

// ============================================================
//  🔌 WEBSOCKET
// ============================================================
let ws = null;
let reconnectTimer = null;

function connect() {
    const streams = COINS.map((c) => `${c.symbol}@ticker`).join("/");
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
buildCards();
connect();