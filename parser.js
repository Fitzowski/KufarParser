const storage = require('./storage');

let browser = null;
let sharedPage = null;

async function initParser(puppeteer) {
    browser = await puppeteer.launch();
    sharedPage = await browser.newPage();
    console.log('[Parser] Браузер для парсинга инициализирован.');
}

async function getBrowser() {
    return browser;
}

async function parsePage(url) {
    await sharedPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    return sharedPage;
}

// === Категории с главной страницы ===

async function getCategories() {
    const cached = storage.getCache('categories');
    if (cached) return cached;

    console.log('[Parser] Парсинг категорий с главной страницы...');
    await sharedPage.goto('https://www.kufar.by', { waitUntil: 'networkidle2', timeout: 60000 });

    const categories = await sharedPage.evaluate(() => {
        const results = [];
        // Kufar использует навигационное меню с ссылками на категории
        const links = document.querySelectorAll('a[href*="/l/"]');
        const seen = new Set();
        for (const link of links) {
            const href = link.getAttribute('href');
            const text = link.innerText.trim();
            if (!href || !text || seen.has(href)) continue;
            // Только основные категории (один сегмент пути)
            const match = href.match(/^\/l\/([a-z-]+)$/);
            if (match) {
                seen.add(href);
                results.push({
                    name: text,
                    slug: match[1],
                    url: `https://www.kufar.by${href}`,
                });
            }
        }
        return results;
    });

    if (categories.length > 0) {
        storage.setCache('categories', categories);
        console.log(`[Parser] Найдено ${categories.length} категорий.`);
    }

    return categories;
}

// === Фильтры для категории ===

async function getFilters(categoryUrl) {
    const cacheKey = `filters_${Buffer.from(categoryUrl).toString('base64').slice(0, 40)}`;
    const cached = storage.getCache(cacheKey);
    if (cached) return cached;

    console.log(`[Parser] Парсинг фильтров: ${categoryUrl}`);
    await sharedPage.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const filters = await sharedPage.evaluate(() => {
        const result = {
            brands: [],
            models: [],
            prices: {},
            other: {},
        };

        // Ищем фильтры в боковой панели
        // Kufar обычно группирует фильтры в секции с заголовками
        const filterSections = document.querySelectorAll('[class*="filter"], [class*="Filter"], [data-testid*="filter"]');

        for (const section of filterSections) {
            const title = section.querySelector('[class*="title"], [class*="label"], h3, h4');
            const titleText = title ? title.innerText.trim().toLowerCase() : '';

            const checkboxes = section.querySelectorAll('input[type="checkbox"], [class*="checkbox"], label');
            const options = [];

            for (const cb of checkboxes) {
                const label = cb.closest('label') || cb;
                const text = label ? label.innerText.trim() : '';
                const value = cb.value || cb.getAttribute('data-value') || text;
                if (text && text.length < 100) {
                    options.push({ label: text, value });
                }
            }

            if (titleText.includes('мар') || titleText.includes('brand') || titleText.includes('производител')) {
                result.brands = options.slice(0, 30);
            } else if (titleText.includes('модел') || titleText.includes('model')) {
                result.models = options.slice(0, 50);
            } else if (titleText.includes('цен') || titleText.includes('price')) {
                const minInput = section.querySelector('input[placeholder*="от"], input[name*="min"]');
                const maxInput = section.querySelector('input[placeholder*="до"], input[name*="max"]');
                result.prices = {
                    min: minInput ? minInput.placeholder : '',
                    max: maxInput ? maxInput.placeholder : '',
                };
            }
        }

        // Альтернативный способ: ищем ссылки-фильтры
        if (result.brands.length === 0) {
            const filterLinks = document.querySelectorAll('a[href*="attr"], a[href*="brand"]');
            const seen = new Set();
            for (const link of filterLinks) {
                const text = link.innerText.trim();
                const href = link.getAttribute('href');
                if (text && href && !seen.has(text) && text.length < 60) {
                    seen.add(text);
                    result.brands.push({ label: text, value: href });
                }
                if (result.brands.length >= 30) break;
            }
        }

        return result;
    });

    if (filters.brands.length > 0 || filters.models.length > 0) {
        storage.setCache(cacheKey, filters);
        console.log(`[Parser] Фильтры: ${filters.brands.length} брендов, ${filters.models.length} моделей.`);
    }

    return filters;
}

// === Парсинг объявлений (существующая функция) ===

async function parseAds(url) {
    await sharedPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    return sharedPage.evaluate(() => {
        return Array.from(document.querySelectorAll('[class^="styles_wrapper_"]')).map(wrapper => {
            const titleElement = wrapper.querySelector('[class^="styles_title_"]');
            const priceElement = wrapper.querySelector('[class^="styles_price_"]');
            const timeElement = wrapper.querySelector('[class^="styles_secondary_"]');
            const linkElement = wrapper.closest('a');
            const link = linkElement ? linkElement.href : null;
            const idMatch = link ? link.match(/\/item\/(\d+)/) : null;
            return {
                id: idMatch ? idMatch[1] : null,
                title: titleElement ? titleElement.innerText.trim() : null,
                price: priceElement ? priceElement.innerText.trim() : null,
                time: timeElement ? timeElement.innerText.trim() : null,
                link: link,
            };
        }).filter(ad => ad.id && ad.title && ad.link && ad.price);
    });
}

// === Построение URL из фильтров ===

function buildUrl(categorySlug, filters) {
    let url = `https://www.kufar.by/l/${categorySlug}`;

    const params = [];
    if (filters.sort) params.push(`sort=${filters.sort}`);

    const filterParts = [];
    for (const [key, values] of Object.entries(filters.selected || {})) {
        if (Array.isArray(values) && values.length > 0) {
            for (const v of values) {
                filterParts.push(`${key}=${encodeURIComponent(v)}`);
            }
        }
    }

    if (filterParts.length > 0 || params.length > 0) {
        const allParams = [...params, ...filterParts];
        url += '?' + allParams.join('&');
    }

    return url;
}

async function closeParser() {
    if (browser) {
        await browser.close().catch(() => {});
    }
}

module.exports = {
    initParser,
    getBrowser,
    getCategories,
    getFilters,
    parseAds,
    buildUrl,
    closeParser,
};
