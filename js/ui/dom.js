/**
 * DOM操作ヘルパーユーティリティ
 */

export const $ = (id) => document.getElementById(id);

export const setText = (el, text) => {
    if (el && text !== undefined && text !== null) {
        el.textContent = String(text);
    }
};

export const setHidden = (el, isHidden) => {
    if (el) {
        el.classList.toggle('hidden', !!isHidden);
    }
};

export const toggleClass = (el, className, force) => {
    if (el) {
        el.classList.toggle(className, force);
    }
};

export const setDisabled = (el, disabled) => {
    if (el) {
        el.disabled = !!disabled;
    }
};

export const on = (el, event, handler, options) => {
    if (el) {
        el.addEventListener(event, handler, options);
    }
};
