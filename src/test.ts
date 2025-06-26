import { checkSite } from './yu.js';

(async () => {
  const result = await checkSite("http://www.9935china-air.com/tejia/HET_HLD.htm");
  console.log(JSON.stringify(result, null, 2));
})();