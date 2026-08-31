const storage = require('./storage');
const parser = require('./parser');

(async () => {
    try {
        await parser.initParser(require('puppeteer'));
        
        // Test getAreas for Brest (region 1)
        const areas = await parser.getAreas(1);
        console.log('Brest areas count:', areas.length);
        console.log('Brest area IDs:', areas.map(a => a.id).join(', '));
        
        // Test buildUrl with Brest region
        const url = parser.buildUrl({ areas: areas.map(a => a.id) });
        console.log('\nBuilt URL:', url);
        
        // Verify area count
        const areaCount = url.match(/ar=v\.or:(.+)/)?.[1]?.split(':').length || 0;
        console.log('\nAreas in URL:', areaCount);
        
        await parser.closeParser();
    } catch (err) {
        console.error('Error:', err.message);
        await parser.closeParser();
    }
})();
