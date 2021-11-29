const baseUrl = 'https://ptx.transportdata.tw/MOTC/v2';
const args = '$format=JSON';
export default class TDXApi {
    constructor(appId, apiKey) {
        this.appId = appId;
        this.apiKey = apiKey;
    }
    async call(path) {
        const url = baseUrl + path + '?' + args;
        const xdate = new Date().toUTCString();
        const signature = await hmac(
            this.apiKey,
            "x-date: " + xdate
        );
        const resp = await fetch(url, {
            headers: new Headers({
                Authorization: `hmac username="${this.appId}", algorithm="hmac-sha1", headers="x-date", signature="${signature}"`,
                "x-date": xdate,
            }),
        });
        return await resp.json();
    }

    async bus(path) {
        return await this.call('/Bus' + path);
    }
}

async function hmac(key, data) {
    const enc = new TextEncoder("utf-8");

    const hmackey = await window.crypto.subtle.importKey(
        "raw", // raw format of the key - should be Uint8Array
        enc.encode(key),
        {
            // algorithm details
            name: "HMAC",
            hash: { name: "SHA-1" },
        },
        false, // export = false
        ["sign", "verify"] // what this key can do
    );

    const signature = await window.crypto.subtle.sign(
        "HMAC",
        hmackey,
        enc.encode(data)
    );
    const decoder = new TextDecoder("utf8");
    const b = new Uint8Array(signature);
    return btoa(String.fromCharCode.apply(null, b));
}
