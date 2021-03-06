let BinHandler = {
    get(target, key) {
        if (key === "load")
            return target.__load__;

        return (val, handler) => {
            let bin = target.__bin__;
            if (val === void 0) return bin[key];
            if (val === null) {
                var old = bin[key];
                delete bin[key]
            }
            else bin[key] = val;
            chrome.storage.local.set({[target.__key__]: bin}, () => handler? handler(): null);
            return key in bin ? bin[key] : old
        }
    },
    has(target, key) {
        return key in target.__bin__;
    },
    * enumerate(target) {
        for (let key in target.__bin__) yield key;
    },
};

export const SETTING_KEY = "scrapyard-settings";
export const DEFAULT_SETTINGS = {
    frame_depth: 5,
    archive_url_lifetime: 5,
    shallow_export: false,
//    compress_export: true,
    show_firefox_bookmarks: true,
    switch_to_new_bookmark: true
};

export let settings = new Proxy({
    __proto__ : null,
    __key__   : SETTING_KEY,
    __bin__   : DEFAULT_SETTINGS,
    __load__  : function(f) {
        chrome.storage.local.get(SETTING_KEY, object =>{
            settings.__bin__ = object[SETTING_KEY]? object[SETTING_KEY]: DEFAULT_SETTINGS;
            if (f) f(this);
        });
    }
}, BinHandler);

settings.load();

chrome.storage.onChanged.addListener(function (changes,areaName) { settings.load() });
