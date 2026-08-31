const storage = require('./storage');
const puppeteer = require('puppeteer');

(async () => {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        // Load base page to get filter data
        await page.goto('https://www.kufar.by/l/mobilnye-telefony?cat=17010', { waitUntil: 'networkidle2', timeout: 60000 });

        const filterData = await page.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            if (!el) return null;
            const json = JSON.parse(el.textContent);
            const filters = json.props?.initialState?.filters;
            if (!filters) return null;

            const refs = filters.metadata?.parameters?.refs || {};
            const currentFilters = filters.currentFilters || [];

            // Find the region filter (rgn)
            const rgnFilter = currentFilters.find(f => f.url_name === 'rgn');
            // Find the area filter (ar)
            const arFilter = currentFilters.find(f => f.url_name === 'ar');

            // Look for region refs (10671, 10672, etc.)
            const regionRefs = {};
            for (const [key, val] of Object.entries(refs)) {
                if (key.startsWith('1067') && val && val.values) {
                    regionRefs[key] = {
                        name: val.labels?.ru || key,
                        multi: val.multi,
                        valuesCount: val.values.length,
                        sampleValues: val.values.slice(0, 3).map(v => ({
                            value: v.value,
                            name: v.labels?.ru
                        }))
                    };
                }
            }

            return {
                rgnFilter: rgnFilter ? {
                    url_name: rgnFilter.url_name,
                    multi: rgnFilter.multi,
                    valuesCount: rgnFilter.values?.length || 0,
                    values: rgnFilter.values?.map(v => ({
                        value: v.value,
                        name: v.labels?.ru
                    }))
                } : null,
                arFilter: arFilter ? {
                    url_name: arFilter.url_name,
                    multi: arFilter.multi,
                    valuesCount: arFilter.values?.length || 0,
                    sampleValues: arFilter.values?.slice(0, 5).map(v => ({
                        value: v.value,
                        name: v.labels?.ru
                    }))
                } : null,
                regionRefs
            };
        });

        console.log('=== rgn filter ===');
        console.log(JSON.stringify(filterData?.rgnFilter, null, 2));

        console.log('\n=== ar filter ===');
        console.log(JSON.stringify(filterData?.arFilter, null, 2));

        console.log('\n=== region refs (1067x) ===');
        console.log(JSON.stringify(filterData?.regionRefs, null, 2));

        // Now test: load page with rgn=10671 to see if it shows Brest only
        console.log('\n=== Testing rgn=10671 ===');
        await page.goto('https://www.kufar.by/l/mobilnye-telefony?cat=17010&rgn=10671', { waitUntil: 'networkidle2', timeout: 60000 });

        const rgnTest = await page.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            if (!el) return null;
            const json = JSON.parse(el.textContent);
            const ads = json.props?.initialState?.delivery?.items || [];
            return {
                count: ads.length,
                locations: ads.slice(0, 10).map(a => a.location?.region || 'unknown')
            };
        });
        console.log(JSON.stringify(rgnTest, null, 2));

        await browser.close();
    } catch (err) {
        console.error('Error:', err.message);
        if (browser) await browser.close().catch(() => {});
    }
})();
