// Конфигурация API и обновления
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const BINANCE_BASE = "https://api.binance.com/api/v3";
const VS_CURRENCY = "usd";

// Поддерживаемые активы для переключателя
const ASSETS = {
  BTC: {
    coingeckoId: "bitcoin",
    binanceSymbol: "BTCUSDT",
    label: "BTC",
    fullName: "Bitcoin",
  },
  ETH: {
    coingeckoId: "ethereum",
    binanceSymbol: "ETHUSDT",
    label: "ETH",
    fullName: "Ethereum",
  },
};

let currentAssetKey = "BTC";
function currentAsset() {
  return ASSETS[currentAssetKey];
}

// Примерная дата следующего халвинга (может немного отличаться по факту)
// Оценка на основе среднего времени блока ~10 минут и высоты после халвинга 2024 года.
const NEXT_HALVING_ESTIMATE_ISO = "2028-04-22T00:00:00Z";

// Элементы DOM
const priceEl = document.getElementById("asset-price");
const changeEl = document.getElementById("asset-change");
const priceLabelEl = document.getElementById("price-label");
const chartTitleEl = document.getElementById("chart-title");
const selectedRangeLabelEl = document.getElementById("selected-range-label");
const chartPanelAssetEl = document.getElementById("chart-panel-asset");
const chartStatLastEl = document.getElementById("chart-stat-last");
const chartStatChangeEl = document.getElementById("chart-stat-change");
const chartStatHighEl = document.getElementById("chart-stat-high");
const chartStatLowEl = document.getElementById("chart-stat-low");
const assetSwitchButtons = Array.from(
  document.querySelectorAll(".asset-btn")
);
const loaderEl = document.getElementById("chart-loader");
const timeframeButtons = Array.from(
  document.querySelectorAll(".timeframe-selector button")
);

const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");

// Элементы для блока истории и калькулятора
const historyCardEl = document.querySelector(".history-card");
const historyTableBodyEl = document.getElementById("history-table-body");
const historyTitleEl = historyCardEl
  ? historyCardEl.querySelector("h3")
  : null;
const historySubtitleEl = historyCardEl
  ? historyCardEl.querySelector(".history-subtitle")
  : null;
const calcEntryEl = document.getElementById("calc-entry-price");
const calcMultiplierEl = document.getElementById("calc-multiplier");
const calcTargetEl = document.getElementById("calc-target-price");

let chartInstance = null;
let currentDays = 1;
let lastPrice = null;

// Упрощённые исторические данные по BTC вокруг прошлых BTC‑халвингов.
// Источники: открытые исследования по истории цены BTC; цифры сильно округлены.
const HALVING_HISTORY = [
  {
    year: 2012,
    priceMinus500: 2, // $
    halvingPrice: 12,
    pricePlus500: 1100,
  },
  {
    year: 2016,
    priceMinus500: 170,
    halvingPrice: 650,
    pricePlus500: 20000,
  },
  {
    year: 2020,
    priceMinus500: 3800,
    halvingPrice: 8820,
    pricePlus500: 69000,
  },
];

// Вспомогательная функция форматирования чисел
function formatPrice(value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 1000) {
    return value.toLocaleString("ru-RU", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return value.toLocaleString("ru-RU", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "";
  return `${value.toFixed(2)}%`;
}

function updateChartStats(points) {
  if (
    !chartStatLastEl ||
    !chartStatChangeEl ||
    !chartStatHighEl ||
    !chartStatLowEl ||
    !points.length
  ) {
    return;
  }

  const prices = points.map((point) => point.price);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

  chartStatLastEl.textContent = formatPrice(last);
  chartStatHighEl.textContent = formatPrice(high);
  chartStatLowEl.textContent = formatPrice(low);
  chartStatChangeEl.textContent =
    changePct >= 0 ? `+${formatPercent(changePct)}` : formatPercent(changePct);
  chartStatChangeEl.classList.remove("positive", "negative");
  chartStatChangeEl.classList.add(changePct >= 0 ? "positive" : "negative");
}

function getRangeLabel(days) {
  switch (Number(days)) {
    case 1:
      return "24 hours";
    case 7:
      return "7 days";
    case 30:
      return "30 days";
    case 180:
      return "6 months";
    case 365:
      return "1 year";
    default:
      return `${days} days`;
  }
}

// Загрузка текущей цены (с запасным провайдером)
async function fetchCurrentPrice() {
  try {
    const asset = currentAsset();
    const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(
      asset.coingeckoId
    )}&vs_currencies=${encodeURIComponent(
      VS_CURRENCY
    )}&include_24hr_change=true`;
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`API error (${res.status})`);
    }

    const data = await res.json();
    const coin = data[asset.coingeckoId];
    if (!coin) {
      throw new Error("Unexpected CoinGecko API response format");
    }

    const price = coin[VS_CURRENCY];
    const changePct = coin[`${VS_CURRENCY}_24h_change`];
    applyPriceToUi(price, changePct);
  } catch (error) {
    console.warn("CoinGecko is unavailable, trying Binance for price", error);
    await fetchCurrentPriceFromBinance();
  }
}

// Запасной провайдер — Binance (BTCUSDT)
async function fetchCurrentPriceFromBinance() {
  try {
    const asset = currentAsset();
    const url = `${BINANCE_BASE}/ticker/24hr?symbol=${asset.binanceSymbol}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Binance API error (${res.status})`);
    }

    const data = await res.json();
    const price = Number.parseFloat(data.lastPrice);
    const changePct = Number.parseFloat(data.priceChangePercent);
    applyPriceToUi(price, changePct);
  } catch (error) {
    console.error(
      "Failed to fetch price from both CoinGecko and Binance",
      error
    );
    changeEl.classList.remove("positive", "negative");
    changeEl.classList.add("muted");
    changeEl.textContent = "Unable to update price (both APIs unavailable)";
  }
}

// Применение цены к UI
function applyPriceToUi(price, changePct) {
  lastPrice = price;
  priceEl.textContent = formatPrice(price);

  changeEl.classList.remove("positive", "negative", "muted");
  const label =
    changePct > 0
      ? `+${formatPercent(changePct)} in 24h`
      : `${formatPercent(changePct)} in 24h`;

  if (changePct > 0) {
    changeEl.classList.add("positive");
  } else if (changePct < 0) {
    changeEl.classList.add("negative");
  } else {
    changeEl.classList.add("muted");
  }
  changeEl.textContent = label;
}

// Загрузка исторических данных для графика (с запасным провайдером)
async function fetchMarketChart(days) {
  const numericDays = Number(days);
  const useDaysParam = Number.isNaN(numericDays) ? days : numericDays;

  // Подбираем интервал в зависимости от диапазона
  let interval = "hourly";
  if (numericDays > 90) {
    interval = "daily";
  } else if (numericDays > 30) {
    interval = "daily";
  }

  try {
    const asset = currentAsset();
    const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(
      asset.coingeckoId
    )}/market_chart?vs_currency=${encodeURIComponent(
      VS_CURRENCY
    )}&days=${encodeURIComponent(useDaysParam)}&interval=${encodeURIComponent(
      interval
    )}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Chart loading error (${res.status})`);
    }

    const data = await res.json();
    if (!data.prices || !Array.isArray(data.prices)) {
      throw new Error("Unexpected chart data format");
    }

    return data.prices.map(([timestamp, price]) => ({
      time: new Date(timestamp),
      price,
    }));
  } catch (error) {
    console.warn("CoinGecko is unavailable, trying Binance for chart", error);
    return fetchMarketChartFromBinance(days);
  }
}

// Запасной провайдер для графика — Binance (BTCUSDT, k‑line)
async function fetchMarketChartFromBinance(days) {
  // Подбираем интервал свечей под диапазон
  let interval = "1h";
  if (days > 7 && days <= 30) {
    interval = "4h";
  } else if (days > 30) {
    interval = "1d";
  }

  const asset = currentAsset();
  const symbol = asset.binanceSymbol;
  // Лимит в пределах 1000, чтобы не перегружать API
  const numericDays = Number(days);
  const limit = Number.isNaN(numericDays)
    ? 1000
    : Math.min(numericDays * 24, 1000);
  const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance kline API error (${res.status})`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected Binance kline data format");
  }

  // Формат строки: [ openTime, open, high, low, close, volume, ... ]
  return data.map((candle) => ({
    time: new Date(candle[0]),
    price: Number.parseFloat(candle[4]),
  }));
}

function showLoader(show) {
  if (!loaderEl) return;
  loaderEl.classList.toggle("visible", show);
}

// Создание или обновление графика
function renderChart(points) {
  const ctx = document.getElementById("btc-chart");
  if (!ctx) return;
  updateChartStats(points);

  const labels = points.map((p) =>
    currentDays <= 2
      ? p.time.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : currentDays <= 90
      ? p.time.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
        })
      : p.time.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        })
  );

  const dataset = points.map((p) => p.price);
  const highValue = Math.max(...dataset);
  const lowValue = Math.min(...dataset);
  const highIndex = dataset.indexOf(highValue);
  const lowIndex = dataset.indexOf(lowValue);

  const gradient = ctx.getContext("2d").createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, "rgba(96, 165, 250, 0.14)");
  gradient.addColorStop(0.65, "rgba(37, 99, 235, 0.06)");
  gradient.addColorStop(1, "rgba(15, 23, 42, 0)");

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = dataset;
    chartInstance.data.datasets[0].label = `${currentAsset().label} / USD`;
    chartInstance.update();
    return;
  }

  const terminalOverlayPlugin = {
    id: "terminalOverlay",
    afterDatasetsDraw(chart) {
      const { ctx: c, chartArea, scales, tooltip } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data.length || !chartArea) return;

      c.save();

      // Right-side last price line and badge
      const lastPoint = meta.data[meta.data.length - 1];
      const lastValue = dataset[dataset.length - 1];
      if (lastPoint && Number.isFinite(lastValue)) {
        c.setLineDash([5, 5]);
        c.lineWidth = 1;
        c.strokeStyle = "rgba(96, 165, 250, 0.28)";
        c.beginPath();
        c.moveTo(chartArea.left, lastPoint.y);
        c.lineTo(chartArea.right, lastPoint.y);
        c.stroke();

        c.setLineDash([]);
        const label = formatPrice(lastValue);
        c.font = "600 11px Inter, system-ui, sans-serif";
        const textWidth = c.measureText(label).width;
        const badgeWidth = textWidth + 18;
        const badgeHeight = 24;
        const badgeX = chartArea.right - badgeWidth - 8;
        const badgeY = Math.min(
          Math.max(lastPoint.y - badgeHeight - 8, chartArea.top + 8),
          chartArea.bottom - badgeHeight - 8
        );

        c.fillStyle = "rgba(8, 15, 30, 0.92)";
        c.strokeStyle = "rgba(96, 165, 250, 0.36)";
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 12);
        c.fill();
        c.stroke();

        c.fillStyle = "rgba(226, 232, 240, 0.96)";
        c.textBaseline = "middle";
        c.fillText(label, badgeX + 9, badgeY + badgeHeight / 2);
      }

      // High / low markers
      const highPoint = meta.data[highIndex];
      const lowPoint = meta.data[lowIndex];
      const drawTag = (point, text, alignTop = true) => {
        if (!point) return;
        c.save();
        c.font = "600 11px Inter, system-ui, sans-serif";
        const width = c.measureText(text).width + 16;
        const height = 22;
        const x = Math.min(Math.max(point.x - width / 2, chartArea.left + 4), chartArea.right - width - 4);
        const y = alignTop ? Math.max(point.y - height - 10, chartArea.top + 6) : Math.min(point.y + 10, chartArea.bottom - height - 6);

        c.fillStyle = "rgba(8, 15, 30, 0.94)";
        c.strokeStyle = "rgba(148, 163, 184, 0.24)";
        c.beginPath();
        c.roundRect(x, y, width, height, 10);
        c.fill();
        c.stroke();

        c.fillStyle = "rgba(226, 232, 240, 0.92)";
        c.textBaseline = "middle";
        c.fillText(text, x + 8, y + height / 2);
        c.restore();
      };

      drawTag(highPoint, `High ${formatPrice(highValue)}`, true);
      drawTag(lowPoint, `Low ${formatPrice(lowValue)}`, false);

      // Crosshair on hover for terminal feel
      if (tooltip && tooltip._active && tooltip._active.length) {
        const active = tooltip._active[0].element;
        const x = active.x;
        const y = active.y;

        c.setLineDash([4, 4]);
        c.strokeStyle = "rgba(148, 163, 184, 0.26)";
        c.lineWidth = 1;

        c.beginPath();
        c.moveTo(x, chartArea.top);
        c.lineTo(x, chartArea.bottom);
        c.stroke();

        c.beginPath();
        c.moveTo(chartArea.left, y);
        c.lineTo(chartArea.right, y);
        c.stroke();

        c.setLineDash([]);
        c.fillStyle = "rgba(125, 211, 252, 1)";
        c.beginPath();
        c.arc(x, y, 4, 0, Math.PI * 2);
        c.fill();
      }

      c.restore();
    },
  };

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${currentAsset().label} / USD`,
          data: dataset,
          borderColor: "rgba(96, 165, 250, 0.98)",
          backgroundColor: gradient,
          borderWidth: 2.2,
          pointRadius: 0,
          pointHitRadius: 16,
          pointHoverRadius: 0,
          pointHoverBorderWidth: 0,
          pointHoverBackgroundColor: "rgba(96, 165, 250, 1)",
          tension: 0.16,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "rgba(2, 6, 23, 0.96)",
          borderColor: "rgba(94, 234, 212, 0.28)",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          titleFont: {
            size: 12,
            weight: "700",
          },
          bodyFont: {
            size: 13,
            weight: "700",
          },
          callbacks: {
            title(contexts) {
              const ctx = contexts[0];
              const label = ctx.label || "";
              return `Time: ${label}`;
            },
            label(context) {
              const value = context.parsed.y;
              return `Price: ${formatPrice(value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "rgba(148, 163, 184, 0.78)",
            maxTicksLimit: 6,
            padding: 10,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.03)",
            drawTicks: false,
            borderColor: "rgba(255, 255, 255, 0.04)",
          },
        },
        y: {
          ticks: {
            color: "rgba(148, 163, 184, 0.78)",
            padding: 12,
            callback(value) {
              if (value >= 1000) {
                const abbreviated = value / 1000;
                return `${abbreviated.toFixed(abbreviated >= 100 ? 0 : 1).replace(".0", "")}k`;
              }
              return value;
            },
          },
          grid: {
            color: "rgba(255, 255, 255, 0.045)",
            drawTicks: false,
            borderColor: "rgba(255, 255, 255, 0.04)",
          },
        },
      },
    },
    plugins: [terminalOverlayPlugin],
  });
}

async function loadChart(days) {
  showLoader(true);
  let hadError = false;
  try {
    const points = await fetchMarketChart(days);
    renderChart(points);
  } catch (error) {
    console.error(error);
    hadError = true;
    if (loaderEl) {
      loaderEl.textContent =
        "Unable to load chart data (CoinGecko rate limit may apply).";
    }
  } finally {
    // Если произошла ошибка, оставляем оверлей с сообщением,
    // чтобы пользователь видел причину пустого графика.
    if (!hadError) {
      showLoader(false);
    } else if (loaderEl) {
      loaderEl.classList.add("visible");
    }
  }
}

function setupTimeframeButtons() {
  timeframeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.days || "1");
      if (days === currentDays) return;

      currentDays = days;
      timeframeButtons.forEach((b) =>
        b.classList.toggle("btn-active", b === btn)
      );
      if (selectedRangeLabelEl) {
        selectedRangeLabelEl.textContent = getRangeLabel(days);
      }
      loadChart(currentDays);
    });
  });
}

// Обратный отсчёт до халвинга
function startHalvingCountdown() {
  const target = new Date(NEXT_HALVING_ESTIMATE_ISO).getTime();
  if (Number.isNaN(target)) {
    console.warn("Invalid halving date");
    return;
  }

  const update = () => {
    const now = Date.now();
    let diff = target - now;

    if (diff <= 0) {
      daysEl.textContent = "0";
      hoursEl.textContent = "0";
      minutesEl.textContent = "0";
      secondsEl.textContent = "0";
      return;
    }

    const sec = Math.floor(diff / 1000);
    const days = Math.floor(sec / (3600 * 24));
    const hours = Math.floor((sec % (3600 * 24)) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;

    daysEl.textContent = String(days);
    hoursEl.textContent = String(hours).padStart(2, "0");
    minutesEl.textContent = String(minutes).padStart(2, "0");
    secondsEl.textContent = String(seconds).padStart(2, "0");
  };

  update();
  setInterval(update, 1000);
}

// Заполнение таблицы истории халвингов
function populateHalvingHistory() {
  if (!historyTableBodyEl) return;

  const rowsHtml = HALVING_HISTORY
    .map((item) => {
      const baseForMultiplier = item.priceMinus500;
      const multiplier =
        baseForMultiplier && item.pricePlus500
          ? item.pricePlus500 / baseForMultiplier
          : null;

      const minus500Cell =
        item.priceMinus500 == null
          ? "—"
          : formatPrice(item.priceMinus500);

      return `
        <tr>
          <td>${item.year}</td>
          <td>${minus500Cell}</td>
          <td>${formatPrice(item.halvingPrice)}</td>
          <td>${formatPrice(item.pricePlus500)}</td>
          <td class="history-multiplier">${
            multiplier ? `×${multiplier.toFixed(1)}` : "—"
          }</td>
        </tr>
      `;
    })
    .join("");

  historyTableBodyEl.innerHTML = rowsHtml;
}

// Калькулятор для текущего цикла
function setupCycleCalculator() {
  if (!calcEntryEl || !calcMultiplierEl || !calcTargetEl) return;

  const recalc = () => {
    const entryValue = Number.parseFloat(calcEntryEl.value);
    const multiplierValue = Number.parseFloat(calcMultiplierEl.value);

    if (
      Number.isNaN(entryValue) ||
      entryValue <= 0 ||
      Number.isNaN(multiplierValue) ||
      multiplierValue <= 0
    ) {
      calcTargetEl.textContent = "—";
      return;
    }

    const targetPrice = entryValue * multiplierValue;
    calcTargetEl.textContent = formatPrice(targetPrice);
  };

  calcEntryEl.addEventListener("input", recalc);
  calcMultiplierEl.addEventListener("input", recalc);

  // Если есть актуальная цена BTC, можно подсказать её как стартовую
  if (lastPrice != null && !Number.isNaN(lastPrice)) {
    calcEntryEl.placeholder = String(Math.round(lastPrice));
  }

  recalc();
}

// Обновление текстовых подписей под текущий актив
function updateAssetTexts() {
  const asset = currentAsset();
  if (priceLabelEl) {
    priceLabelEl.textContent = `Current ${asset.label} price`;
  }
  if (chartTitleEl) {
    chartTitleEl.textContent = `Live ${asset.label} / USD chart`;
  }
  if (chartPanelAssetEl) {
    chartPanelAssetEl.textContent = `${asset.label} / USD`;
  }
  if (selectedRangeLabelEl) {
    selectedRangeLabelEl.textContent = getRangeLabel(currentDays);
  }

  // Блок истории показываем только для BTC, для ETH скрываем полностью.
  if (historyCardEl) {
    if (currentAssetKey === "ETH") {
      historyCardEl.style.display = "none";
    } else {
      historyCardEl.style.display = "";
    }
  }
}

// Переключатель активов BTC / ETH
function setupAssetSwitch() {
  if (!assetSwitchButtons.length) return;

  assetSwitchButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const assetKey = btn.dataset.asset;
      if (!ASSETS[assetKey] || assetKey === currentAssetKey) return;

      currentAssetKey = assetKey;

      assetSwitchButtons.forEach((b) =>
        b.classList.toggle("asset-btn-active", b === btn)
      );

      updateAssetTexts();
      loadChart(currentDays);
      fetchCurrentPrice();
    });
  });
}

// Инициализация
function init() {
  setupTimeframeButtons();
  setupAssetSwitch();
  updateAssetTexts();
  loadChart(currentDays);
  fetchCurrentPrice();
  startHalvingCountdown();
  populateHalvingHistory();
  setupCycleCalculator();

  // Обновление цены каждые 20 секунд
  setInterval(fetchCurrentPrice, 20_000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

