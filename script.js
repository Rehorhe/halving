// Конфигурация API и обновления
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const BINANCE_BASE = "https://api.binance.com/api/v3";
const COIN_ID = "bitcoin";
const VS_CURRENCY = "usd";

// Примерная дата следующего халвинга (может немного отличаться по факту)
// Оценка на основе среднего времени блока ~10 минут и высоты после халвинга 2024 года.
const NEXT_HALVING_ESTIMATE_ISO = "2028-04-22T00:00:00Z";

// Элементы DOM
const priceEl = document.getElementById("btc-price");
const changeEl = document.getElementById("btc-change");
const loaderEl = document.getElementById("chart-loader");
const timeframeButtons = Array.from(
  document.querySelectorAll(".timeframe-selector button")
);

const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");

// Элементы для блока истории и калькулятора
const historyTableBodyEl = document.getElementById("history-table-body");
const calcEntryEl = document.getElementById("calc-entry-price");
const calcMultiplierEl = document.getElementById("calc-multiplier");
const calcTargetEl = document.getElementById("calc-target-price");

let chartInstance = null;
let currentDays = 1;
let lastPrice = null;

// Упрощённые исторические данные по прошлым халвингам
// Источники: открытые исследования по истории цены BTC; цифры округлены.
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

// Загрузка текущей цены (с запасным провайдером)
async function fetchCurrentPrice() {
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(
      COIN_ID
    )}&vs_currencies=${encodeURIComponent(
      VS_CURRENCY
    )}&include_24hr_change=true`;
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`Ошибка API (${res.status})`);
    }

    const data = await res.json();
    const coin = data[COIN_ID];
    if (!coin) {
      throw new Error("Неожиданный формат ответа API CoinGecko");
    }

    const price = coin[VS_CURRENCY];
    const changePct = coin[`${VS_CURRENCY}_24h_change`];
    applyPriceToUi(price, changePct);
  } catch (error) {
    console.warn("CoinGecko недоступен, пробуем Binance для цены", error);
    await fetchCurrentPriceFromBinance();
  }
}

// Запасной провайдер — Binance (BTCUSDT)
async function fetchCurrentPriceFromBinance() {
  try {
    const url = `${BINANCE_BASE}/ticker/24hr?symbol=BTCUSDT`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Ошибка Binance API (${res.status})`);
    }

    const data = await res.json();
    const price = Number.parseFloat(data.lastPrice);
    const changePct = Number.parseFloat(data.priceChangePercent);
    applyPriceToUi(price, changePct);
  } catch (error) {
    console.error("Не удалось получить цену BTC ни с CoinGecko, ни с Binance", error);
    changeEl.classList.remove("positive", "negative");
    changeEl.classList.add("muted");
    changeEl.textContent = "Не удалось обновить цену (оба API недоступны)";
  }
}

// Применение цены к UI
function applyPriceToUi(price, changePct) {
  lastPrice = price;
  priceEl.textContent = formatPrice(price);

  changeEl.classList.remove("positive", "negative", "muted");
  const label =
    changePct > 0
      ? `+${formatPercent(changePct)} за 24ч`
      : `${formatPercent(changePct)} за 24ч`;

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
  try {
    const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(
      COIN_ID
    )}/market_chart?vs_currency=${encodeURIComponent(
      VS_CURRENCY
    )}&days=${encodeURIComponent(days)}&interval=hourly`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Ошибка загрузки графика (${res.status})`);
    }

    const data = await res.json();
    if (!data.prices || !Array.isArray(data.prices)) {
      throw new Error("Неожиданный формат данных графика");
    }

    return data.prices.map(([timestamp, price]) => ({
      time: new Date(timestamp),
      price,
    }));
  } catch (error) {
    console.warn("CoinGecko недоступен, пробуем Binance для графика", error);
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

  const symbol = "BTCUSDT";
  // Лимит в пределах 1000, чтобы не перегружать API
  const limit = Math.min(days * 24, 1000);
  const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ошибка Binance kline API (${res.status})`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Неожиданный формат данных Binance kline");
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

  const labels = points.map((p) =>
    currentDays <= 1
      ? p.time.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : p.time.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
        })
  );

  const dataset = points.map((p) => p.price);

  const gradient = ctx.getContext("2d").createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, "rgba(247, 147, 26, 0.42)");
  gradient.addColorStop(1, "rgba(15, 23, 42, 0.05)");

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = dataset;
    chartInstance.update();
    return;
  }

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "BTC / USD",
          data: dataset,
          borderColor: "rgba(247, 147, 26, 0.96)",
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0.25,
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
          backgroundColor: "rgba(15, 23, 42, 0.96)",
          borderColor: "rgba(148, 163, 184, 0.6)",
          borderWidth: 1,
          titleFont: {
            size: 11,
          },
          bodyFont: {
            size: 11,
          },
          callbacks: {
            label(context) {
              const value = context.parsed.y;
              return ` ${formatPrice(value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "rgba(148, 163, 184, 0.9)",
            maxTicksLimit: 6,
          },
          grid: {
            display: false,
          },
        },
        y: {
          ticks: {
            color: "rgba(148, 163, 184, 0.9)",
            callback(value) {
              if (value >= 1000) {
                return `${(value / 1000).toFixed(0)}k`;
              }
              return value;
            },
          },
          grid: {
            color: "rgba(31, 41, 55, 0.7)",
          },
        },
      },
    },
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
        "Не удалось загрузить график (возможно, лимит CoinGecko).";
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
      loadChart(currentDays);
    });
  });
}

// Обратный отсчёт до халвинга
function startHalvingCountdown() {
  const target = new Date(NEXT_HALVING_ESTIMATE_ISO).getTime();
  if (Number.isNaN(target)) {
    console.warn("Некорректная дата халвинга");
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

  const rowsHtml = HALVING_HISTORY.map((item) => {
    const multiplier = item.pricePlus500 / item.priceMinus500;
    return `
      <tr>
        <td>${item.year}</td>
        <td>${formatPrice(item.priceMinus500)}</td>
        <td>${formatPrice(item.halvingPrice)}</td>
        <td>${formatPrice(item.pricePlus500)}</td>
        <td class="history-multiplier">×${multiplier.toFixed(1)}</td>
      </tr>
    `;
  }).join("");

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

// Инициализация
function init() {
  setupTimeframeButtons();
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

