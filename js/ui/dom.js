/**
 * DOM操作ヘルパーユーティリティ (ワンライナー)
 */

export const $ = (id) => document.getElementById(id);
export const setText = (el, text) => el && (el.textContent = text ?? '');
export const setHidden = (el, isHidden) => el?.classList.toggle('hidden', !!isHidden);
export const toggleClass = (el, className, force) => el?.classList.toggle(className, force);
export const setDisabled = (el, disabled) => el && (el.disabled = !!disabled);
export const on = (el, event, handler, options) => el?.addEventListener(event, handler, options);
