const storage = require('./storage');

let browser = null;
let sharedPage = null;

const CATEGORY_URL = 'https://www.kufar.by/l/mobilnye-telefony';

const REGIONS = [
    { id: 7, name: 'Минск', rgn: '7', areaRef: '10676' },
    { id: 1, name: 'Брестская область', rgn: '1', areaRef: '10671' },
    { id: 2, name: 'Гомельская область', rgn: '2', areaRef: '10672' },
    { id: 3, name: 'Гродненская область', rgn: '3', areaRef: '10677' },
    { id: 4, name: 'Могилёвская область', rgn: '4', areaRef: '10673' },
    { id: 5, name: 'Минская область', rgn: '5', areaRef: '10674' },
    { id: 6, name: 'Витебская область', rgn: '6', areaRef: '10675' },
];

async function initParser(puppeteer) {
    browser = await puppeteer.launch({ headless: true });
    sharedPage = await browser.newPage();
    await sharedPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    console.log('[Parser] Браузер инициализирован.');
}

async function closeParser() {
    if (browser) {
        await browser.close().catch(() => {});
    }
}

async function loadPageData(url) {
    console.log(`[Parser] Загрузка: ${url}`);
    await sharedPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    return sharedPage.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        const json = JSON.parse(el.textContent);
        const filters = json.props?.initialState?.filters;
        if (!filters) return null;

        const refs = filters.metadata?.parameters?.refs || {};
        const currentFilters = filters.currentFilters || [];

        return { currentFilters, refs };
    });
}

async function getBrands() {
    const cacheKey = 'brands';
    const cached = storage.getCache(cacheKey);
    if (cached) return cached;

    const data = await loadPageData(CATEGORY_URL);
    if (!data) return [];

    const brandFilter = data.currentFilters.find(f => f.url_name === 'pb');
    if (!brandFilter || !brandFilter.values) return [];

    const brands = brandFilter.values.map(v => ({
        id: parseInt(v.value, 10),
        name: v.labels.ru,
    }));

    storage.setCache(cacheKey, brands);
    console.log(`[Parser] Загружено ${brands.length} брендов.`);
    return brands;
}

async function getModels(brandId) {
    const cacheKey = `models_${brandId}`;
    const cached = storage.getCache(cacheKey);
    if (cached) return cached;

    const data = await loadPageData(`${CATEGORY_URL}?pb=${brandId}`);
    if (!data) return [];

    const modelFilter = data.currentFilters.find(f => f.url_name === 'phm');
    if (!modelFilter || !modelFilter.values) return [];

    const models = modelFilter.values.map(v => ({
        id: parseInt(v.value, 10),
        name: v.labels.ru,
    }));

    storage.setCache(cacheKey, models);
    console.log(`[Parser] Загружено ${models.length} моделей для brand=${brandId}.`);
    return models;
}

function getRegions() {
    return REGIONS.map(r => ({ id: r.id, name: r.name }));
}

async function getAreas(regionId) {
    const cacheKey = `areas_${regionId}`;
    const cached = storage.getCache(cacheKey);
    if (cached) return cached;

    const region = REGIONS.find(r => r.id === regionId);
    if (!region) return [];

    const data = await loadPageData(CATEGORY_URL);
    if (!data) return [];

    const areaRef = data.refs[region.areaRef];
    if (!areaRef || !areaRef.values) return [];

    const areas = areaRef.values.map(v => ({
        id: parseInt(v.value, 10),
        name: v.labels.ru,
    }));

    storage.setCache(cacheKey, areas);
    console.log(`[Parser] Загружено ${areas.length} городов для region=${regionId}.`);
    return areas;
}

function buildUrl(filters) {
    const params = [];

    params.push('cat=17010');

    if (filters.brand) params.push(`pb=${filters.brand}`);
    if (filters.models && filters.models.length > 0) {
        if (filters.models.length === 1) {
            params.push(`phm=${filters.models[0]}`);
        } else {
            params.push(`phm=v.or:${filters.models.join(':')}`);
        }
    }
    if (filters.priceFrom || filters.priceTo) {
        const from = filters.priceFrom || 0;
        const to = filters.priceTo || 1000000000;
        params.push(`prc=${from}::${to}`);
    }
    if (filters.region) {
        params.push(`rgn=${filters.region}`);
    } else if (filters.area) {
        params.push(`ar=${filters.area}`);
    }

    return `${CATEGORY_URL}?${params.join('&')}`;
}

function getRegionRgn(regionId) {
    const region = REGIONS.find(r => r.id === regionId);
    return region ? region.rgn : null;
}

async function parseAds(url) {
    await sharedPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    return sharedPage.evaluate(() => {
        return Array.from(document.querySelectorAll('[class^="styles_wrapper_"]')).map(wrapper => {
            const titleElement = wrapper.querySelector('[class^="styles_title_"]');
            const priceElement = wrapper.querySelector('[class^="styles_price_"]');
            const secondaryEl = wrapper.querySelector('[class^="styles_secondary_"]');
            const regionEl = secondaryEl ? secondaryEl.querySelector('[class*="region"]') : null;
            const timeEl = secondaryEl ? secondaryEl.querySelector('span') : null;
            const linkElement = wrapper.closest('a');
            const link = linkElement ? linkElement.href : null;
            const idMatch = link ? link.match(/\/item\/(\d+)/) : null;
            return {
                id: idMatch ? idMatch[1] : null,
                title: titleElement ? titleElement.innerText.trim() : null,
                price: priceElement ? priceElement.innerText.trim() : null,
                location: regionEl ? regionEl.innerText.trim() : null,
                time: timeEl ? timeEl.innerText.trim() : null,
                link: link,
            };
        }).filter(ad => ad.id && ad.title && ad.link && ad.price);
    });
}

module.exports = {
    initParser,
    closeParser,
    getBrands,
    getModels,
    getRegions,
    getAreas,
    buildUrl,
    getRegionRgn,
    parseAds,
    CATEGORY_URL,
    REGIONS,
};
