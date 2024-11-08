import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { calculateProfit } from './calculateProfit.ts';
import fs from 'node:fs';
import { Centrifuge } from 'centrifuge';
import EventSource from 'eventsource';
const configPath = './config.json';

interface Config {
    liquidity: number;
    profit: number;
    quantity: number;
    api_key: string;
    min: number;
    max: number;
    interval: number;
}

interface Status {
    Status: string;
    Name: string;
    Balance: string | number;
    Liquidity: number;
    "Min price": string;
    "Max price": string;
    'Profit Percent': string;
}

export default class WhiteMarket {
    private telegrambot: any;
    private telegramid: any;
    private liquidity: number;
    private profit: number;
    private quantity: number;
    private api_token: string;
    private auth_token: string | null;
    private Balance: number;
    private limit_min: number;
    private limit_max: number;
    private interval: number;
    private status: Status;
    private white_market_graphql: AxiosInstance;
    private checked_id: Record<string, { name: string, price: number; timeoutId: NodeJS.Timeout }>;
    private messageArray: string[];
    private runInterval: NodeJS.Timeout | null;
    private getProfileInfoInterval: NodeJS.Timeout | undefined;
    private eventSource: EventSource | null = null;
    private centrifuge: Centrifuge | null = null;
    private reconnectAttempts: number = 0;
    private readonly maxDelay: number = 30000;
    private readonly wsUrl: string = 'wss://api.white.market/ws_endpoint';

    constructor(config: Config, telegrambot: any, telegramid: any) {
        this.telegrambot = telegrambot;
        this.telegramid = telegramid;
        this.liquidity = config.liquidity;
        this.profit = config.profit;
        this.quantity = config.quantity;
        this.api_token = config.api_key;
        this.auth_token = null;
        this.Balance = 0;
        this.limit_min = config.min;
        this.limit_max = config.max;
        this.interval = config.interval;
        this.status = {
            Status: 'offline',
            Name: '',
            Balance: this.Balance,
            Liquidity: this.liquidity,
            "Min price": `${this.limit_min}$`,
            "Max price": `${this.limit_max}$`,
            'Profit Percent': `${this.profit * 100}%`,
        };
        this.white_market_graphql = axios.create({
            baseURL: "https://api.white.market/graphql/partner",
            headers: {
                'Content-Type': "application/json"
            },
            method: 'post'
        });
        this.checked_id = {};
        this.messageArray = [];
        setInterval(() => {
            if (this.messageArray.length === 0) return;
            const message = this.messageArray.shift()!;
            this.telegrambot.sendMessage(this.telegramid, message);
        }, 1000);
        this.runInterval = null;
        setInterval(() => this.getAuthToken(), 30 * 60 * 1000);
        setInterval(() => this.updateStatus(), 1 * 60 * 1000);
        this.updateStatus();
    };

    public checkStatus() {
        this.status.Balance = `${this.Balance}$`;
        this.status['Max price'] = `${this.limit_max}$`;
        this.status['Min price'] = `${this.limit_min}$`;
        this.status.Liquidity = this.liquidity;
        this.status['Profit Percent'] = `${(this.profit * 100).toFixed(2)}%`;
        const formattedString = Object.entries(this.status)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');
        this.messageArray.push(formattedString);
    }

    public async updateStatus() {
        const userInfo = await this.getUserInfo();
        if (userInfo?.data?.person_profile?.steamName) {
            this.status.Name = userInfo.data.person_profile.steamName;
        }
        const Balance = await this.getBalance();
        if (Balance?.data?.wallet_balances[0]?.value) {
            this.Balance = Balance.data.wallet_balances[0].value;
        }
    }

    public async runBot() {
        this.status.Status = 'online';
        this.updateStatus();
        const status = await this.startWebSocket();
        if (status === 'online') {
            return;
        };
        this.messageArray.push(`WhiteMarket bot: ${this.status.Name} Started`);
    };

    public async stopBot() {
        if (this.runInterval) clearInterval(this.runInterval);
        this.stopWS_SSE();
        this.runInterval = null;
        this.status.Status = 'offline';
        this.messageArray.push(`WhiteMarket bot: ${this.status.Name} Stopped`);
    };

    private async startSSE(reconnectAttempts = 0) {
        if (!this.auth_token) await this.getAuthToken();
        if (!this.auth_token) {
            this.messageArray.push("Authentication failed for SSE: Missing token");
            return;
        };
        const url = new URL('https://api.white.market/sse_endpoint');
        url.searchParams.append("cf_connect", JSON.stringify({
            'token': this.auth_token,
            'subs': { "market_products_updates": {} }
        }));

        this.eventSource = new EventSource(url.toString());

        this.eventSource.addEventListener("open", () => {
            this.messageArray.push("Connected to SSE for live updates.");
            reconnectAttempts = 0; // Reset attempts on successful connection
        });

        this.eventSource.addEventListener("message", (event: MessageEvent) => {
            this.handleLiveUpdate(event.data);
        });
        this.eventSource.addEventListener("error", (error: Event) => {
            console.error("SSE Error:", error);
            if (this.eventSource) this.eventSource.close();
            // Reconnect with exponential backoff
            const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
            setTimeout(() => {
                this.startSSE(reconnectAttempts + 1);
            }, delay);
        });
    };

    private stopWS_SSE(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        };
        if (this.centrifuge) {
            this.centrifuge.disconnect();
            this.messageArray.push("WebSocket connection stopped.");
        } else {
            this.messageArray.push("WebSocket is not running.");
        };
    };

    private async startWebSocket() {
        if (this.centrifuge && this.centrifuge.state === "connected") {
            this.messageArray.push(`Websocket for ${this.status.Name} is already running !`);
            return 'online';
        };
        if (!this.auth_token || this.auth_token == "") await this.getAuthToken();
        this.centrifuge = new Centrifuge(this.wsUrl, {
            debug: false,
            token: this.auth_token ?? "",
            minReconnectDelay: 1000, // minimum delay in ms before reconnect attempt
            maxReconnectDelay: 5000, // maximum delay in ms
        });
        this.centrifuge.on('connecting', (ctx: any) => {
            // console.log(`Connecting: ${ctx.reason}`);
        });

        this.centrifuge.on('connected', (ctx: any) => {
            console.log(`Connected over ${ctx.transport}`);
        });

        this.centrifuge.on('disconnected', (ctx: any) => {
            console.log(`Disconnected: ${ctx.reason}`);
        });
        const sub = this.centrifuge.newSubscription('market_products_updates');
        sub.on('publication', (ctx: any) => {
            this.handleLiveUpdate(ctx.data.message, true);
        });
        sub.subscribe(); // Subscribe to the channel
        this.centrifuge.connect(); // Connect the centrifuge client
    };
    private reconnectWithBackoff() {
        if (this.centrifuge) this.centrifuge.disconnect();
        setTimeout(() => {
            this.reconnectAttempts += 1;
            this.startWebSocket();
        }, 1000);
    }
    public changeLimitMin(limit: number): void {
        this.limit_min = limit;
        this.messageArray.push(`Min price for ${this.status.Name} changed to ${this.limit_min}$`);
    }

    public changeLimitMax(limit: number): void {
        this.limit_max = limit;
        this.messageArray.push(`Max price for ${this.status.Name} changed to ${this.limit_max}$`);
    }

    public changeProfit(profit: number): void {
        this.profit = profit / 100;
        this.messageArray.push(`Profit for ${this.status.Name} changed to ${(this.profit * 100).toFixed(2)}%`);
    }

    public changeLiquidity(liquid: number): void {
        this.liquidity = liquid;
        this.messageArray.push(`Liquidity for ${this.status.Name} changed to ${this.liquidity}`);
    }

    public changeQuantity(quantity: number): void {
        this.quantity = quantity;
        this.messageArray.push(`Quantity for ${this.status.Name} changed to ${this.quantity}`);
    }

    private handleLiveUpdate(raw_data: string, isWS: boolean = false) {
        try {
            const parsed_data = JSON.parse(raw_data);
            let data = parsed_data;
            if (!isWS) {
                if (!parsed_data.pub?.data?.message) return;
                data = JSON.parse(parsed_data.pub.data.message);
            };
            if (!data) return;
            if (data.type === 'market_product_removed') {
                if (this.checked_id[data.content.id]) delete this.checked_id[data.content.id];
                return;
            };
            let name: string = '';
            let price: number = 0;
            if (data.type === 'market_product_edited' && this.checked_id[data.content.id]) {
                name = this.checked_id[data.content.id].name;
                price = data.content.price;
            };
            if (!data.content?.name_hash && name === '') return;
            name = data.content.name_hash;
            if (!name || name === '') return;
            const id = data.content.id;
            price = data.content.price;
            if (price < this.limit_min || price > this.limit_max || price == 0) return;
            if (this.checked_id[id] && this.checked_id[id].price == price) return;
            this.checked_id[id] = {
                name: name,
                price: price,
                timeoutId: setTimeout(() => {
                    delete this.checked_id[id];
                }, 24 * 60 * 60 * 1000)
            };
            const result = calculateProfit(name, price, 1, this.liquidity, this.quantity);
            if (!result) return;
            if (result[0] >= this.profit) {
                this.buyItem(id, price, name, result);
            };
        } catch (error) {
            console.log('failed parse message: ', error);
        }
    }


    public async changeApikey(new_key: string) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            let keyUpdated = false;
            for (const account of config.whitemarket) {
                if (account.api_key === this.api_token) {
                    const old_key = this.api_token;
                    this.api_token = new_key;
                    const testKey = await this.getAuthToken();
                    if (!testKey?.data?.auth_token?.accessToken) {
                        this.api_token = old_key;
                        this.messageArray.push(`New API key not working, changed to old one !`);
                        return;
                    }
                    account.api_key = new_key;
                    keyUpdated = true;
                    break;
                }
            }
            if (keyUpdated) {
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
                this.messageArray.push(`New API key has been saved for account. Changing to new key.`);
                this.updateStatus();
            }
        } catch (error) {
            this.messageArray.push(`Failed to update API key due to error: ${error}`);
        }
    }

    private async checkNewItems() {
        const items = await this.getNewestItem(this.limit_min, this.limit_max);
        if (items?.data?.market_list?.edges) {
            for (const item of items.data.market_list.edges) {
                const name = item.node?.item?.description?.nameHash;
                if (!name) continue;
                const id = item.node.id;
                const price = item.node.price.value;
                if (this.checked_id[id] && this.checked_id[id].price === price) continue;
                this.checked_id[id] = {
                    name: name,
                    price: price,
                    timeoutId: setTimeout(() => {
                        delete this.checked_id[id];
                    }, 30 * 60 * 1000)
                };
                const result = calculateProfit(name, price, 1, this.liquidity, this.quantity);
                if (!result) continue;
                if (result[0] >= this.profit) {
                    this.buyItem(id, price, name, result);
                }
            }
        }
    }

    private async sendRequest(config: AxiosRequestConfig) {
        if (this.auth_token) {
            this.white_market_graphql.defaults.headers['Authorization'] = `Bearer ${this.auth_token}`;
        }
        try {
            const res = await this.white_market_graphql(config);
            return res.data;
        } catch (err: any) {
            console.log('Error in sendRequest:', err.response ? err.response.data : err.message, 'Key: ', this.api_token);
            return;
        }
    }

    public async getUserInfo() {
        if (!this.auth_token) await this.getAuthToken();
        const query = `query { person_profile { steamName } }`;
        return await this.sendRequest({ data: { query } });
    }

    public async getBalance() {
        if (!this.auth_token) await this.getAuthToken();
        const query = `query { wallet_balances { value } }`;
        return await this.sendRequest({ data: { query } });
    }

    private async getAuthToken() {
        const query = `mutation { auth_token { accessToken } }`;
        try {
            const res = await this.sendRequest({
                headers: { "X-partner-token": this.api_token },
                data: { query }
            });
            if (res?.data?.auth_token?.accessToken) {
                this.auth_token = res.data.auth_token.accessToken;
            }
            return res;
        } catch (error) {
            console.log(error);
            return;
        }
    }

    private async getNewestItem(min_price: number, max_price: number) {
        if (!this.auth_token) await this.getAuthToken();
        const query = `query { market_list( search: { appId: CSGO, priceFrom: { value: "${min_price}", currency: USD }, priceTo: { value: "${max_price}", currency: USD }, sort: { field: CREATED, type: DESC } }, forwardPagination: { first: 100 } ) { edges { node { id price { value } item { description { nameHash } } } } } }`;
        return await this.sendRequest({ data: { query } });
    }

    private async buyItem(id: string, price: number, name: string, result: number[]) {
        if (!this.auth_token) await this.getAuthToken();
        const query = `mutation { market_buy( id: "${id}", maxPriceInput: { value: "${price}", currency: USD } ) { id } }`;
        const res = await this.sendRequest({ data: { query } });
        if (res?.data) {
            this.messageArray.push(`Whitemarket Buy | Account: ${this.status.Name} | Name: ${name} | Price: ${price}$ | Profit percent: ${(result[0] * 100).toFixed(2)}%`);
        } else if (res?.errors) {
            this.messageArray.push(`Whitemarket Buy Failed | Account: ${this.status.Name} | Name: ${name} | Price: ${price} | Profit percent: ${(result[0] * 100).toFixed(2)}% | Reason: ${res.errors[0]?.message || res.errors}`);
        };
    }
}
