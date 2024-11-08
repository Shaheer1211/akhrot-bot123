import https from 'node:https';
import axios, { AxiosRequestConfig } from 'axios';
import fs from 'node:fs';
const banlistData = await Deno.readTextFile('./banlist.json');
const banlist = JSON.parse(banlistData);

const cache = new Map<string, any>();
const holofoil = "Holo/Foil";
const replaced_holofoil = "Holo-Foil";
let row: any = {};
let cacheDate: number = 0;

cacheFromDB();

async function cacheFromDB(): Promise<void> {
    const config: AxiosRequestConfig = {
        url: 'https://tktq40.xyz/cache',
        method: 'get',
        headers: {
            'Authorization': 'akhrot8'
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        })
    };

    try {
        const res = await axios.request(config);
        if (res?.data?.data) {
            for (const [key, value] of Object.entries(res.data.data)) {
                cache.set(key, value);
            }
        }
    } catch (err: any) {
        if (err?.response?.status < 500) {
            console.log('Error getting data:', err.response.data);
        }
    }
}

setInterval(() => {
    cacheFromDB();
}, 3 * 60 * 60 * 1000);

function updateBanList(name: string): void {
    banlist.push(name);
    fs.writeFileSync('./banlist.json', JSON.stringify(banlist, null, 2));
}

function removeFromBanList(nameToRemove: string): void {
    const updatedBanlist = banlist.filter((name: string) => name !== nameToRemove);
    fs.writeFileSync('./banlist.json', JSON.stringify(updatedBanlist, null, 2));
}

function checkCurrentList(): string {
    return banlist.join(', ');
}

function calculateProfit(item_name: string, item_price: number, site_rate: number, liquidity: number = 80, quantity: number = 50): [number, number] | undefined {
    const isBanned = banlist.some(banned => item_name.includes(banned));
    if (isBanned) return;
    if (item_name.includes('Statrak') && (item_name.includes('Well-Worn') || item_name.includes('Battle-Scared'))) return;
    if (item_name.includes('Doppler') && item_name.includes('Minimal Wear')) return;

    row = cache.get(item_name);
    if (!row || !row.buff?.price || row.liquidity < liquidity || row.buff?.count < quantity) {
        return;
    }

    const BuffPrice = row.buff.price / 100;
    const product = item_price * site_rate;
    const ROI = (BuffPrice - product) / product;
    return [ROI, BuffPrice];
}

function checkCacheDate(): number {
    return cacheDate;
}

function DopplerNameChange(knifeName: string): string {
    const phrasesToRemove = ['Emerald', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl'];
    const pattern = new RegExp(`(\\s*[-–—]*\\s*)\\b(${phrasesToRemove.join('|')})\\b`, 'gi');
    return knifeName.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

export {
    calculateProfit,
    checkCacheDate,
    updateBanList,
    checkCurrentList,
    removeFromBanList,
    DopplerNameChange
};
