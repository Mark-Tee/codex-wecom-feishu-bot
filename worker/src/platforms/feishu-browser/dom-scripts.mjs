import { normalizeOption } from "./field-options.mjs";

const DOM_HELPERS = `
  const normalizeText = ${normalizeOption.toString()};
  const isVisibleElement = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none";
  };
  const centerOf = (element, scroll = false) => {
    if (scroll) element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };
`;

export function fieldSelector(fieldId, mode = "form") {
  if (!/^fld[A-Za-z0-9]+$/.test(String(fieldId || ""))) {
    throw new Error(`无效的飞书字段 ID：${fieldId}`);
  }
  return mode === "record"
    ? `.base_record_card_field_editor_wrapper:has(> label[data-field-id="${fieldId}"])`
    : `#field-item-${fieldId}`;
}

export function visibleElementScript(selector) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return null;
    const candidates = [...root.querySelectorAll(
      '[contenteditable="true"], input, textarea, [role="combobox"], button, [class*="select"]'
    )].filter(isVisibleElement);
    return candidates.map((element) => ({
      tag: element.tagName,
      className: String(element.className || ""),
      ...centerOf(element),
    }));
  })()`;
}

export function optionRectScript(value) {
  return `(() => {
    ${DOM_HELPERS}
    const wanted = normalizeText(${JSON.stringify(value)});
    const roleOptions = [...document.querySelectorAll('[role="option"]')].filter(isVisibleElement);
    const classOptions = [...document.querySelectorAll('[class*="option"], [class*="Option"]')]
      .filter(isVisibleElement);
    const generic = [...document.querySelectorAll('li, [role="menuitem"], div, span')]
      .filter((element) => element.childElementCount === 0 && isVisibleElement(element));
    const candidates = [...roleOptions, ...classOptions, ...generic];
    const element = candidates.find((candidate) => normalizeText(candidate.textContent) === wanted);
    if (!element) return null;
    return {
      ...centerOf(element),
      text: String(element.textContent || "").trim(),
    };
  })()`;
}

export function dropdownRectScript(selector) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    const element = root?.querySelector(
      '.b-select-dropdown-menu, .bitable-user-editor-selector, [role="combobox"]'
    ) || root;
    if (!element) return null;
    return centerOf(element, true);
  })()`;
}

export function personOptionRectScript(selector, value) {
  return `(() => {
    ${DOM_HELPERS}
    const wanted = normalizeText(${JSON.stringify(value)});
    const root = document.querySelector(${JSON.stringify(selector)});
    const roots = [...(root?.querySelectorAll('.larkw-option-item__title__content') || [])]
      .filter(isVisibleElement);
    const element = roots.find((candidate) => normalizeText(candidate.textContent).includes(wanted));
    if (!element) return null;
    const item = element.closest('.larkw-option-item') || element;
    return {
      ...centerOf(item),
      text: String(item.textContent || '').trim(),
    };
  })()`;
}

export function openPersonSelectorScript(selector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    const selectorElement = root?.querySelector('.b-select-dropdown-menu');
    if (!selectorElement) return false;
    selectorElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    selectorElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    selectorElement.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    const input = root.querySelector('input.b-select-search');
    input?.focus();
    return document.activeElement === input;
  })()`;
}

export function clickVisibleTextScript(text) {
  return `(() => {
    ${DOM_HELPERS}
    const wanted = ${JSON.stringify(text)};
    const labelOf = (element) => String(
      element.innerText
      || element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.textContent
      || ''
    ).trim();
    const leaf = [...document.querySelectorAll('*')].find((element) => (
      element.childElementCount === 0
      && isVisibleElement(element)
      && labelOf(element) === wanted
    ));
    if (leaf) {
      const target = leaf.closest('[class*="tab"], [role="tab"], [class*="view"]') || leaf;
      target.click();
      return true;
    }
    const button = [...document.querySelectorAll('button')].find((element) => (
      isVisibleElement(element) && labelOf(element) === wanted
    ));
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

export function fieldContainsValueScript(selector, value) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    const menu = root?.querySelector('.b-select-dropdown-menu');
    const wanted = normalizeText(${JSON.stringify(value)});
    const selected = [...(root?.querySelectorAll('.b-select-value-list .b-user-tag-text') || [])]
      .map((element) => normalizeText(element.textContent));
    return selected.length
      ? selected.includes(wanted)
      : normalizeText(menu?.innerText).includes(wanted);
  })()`;
}

export function visibleButtonPointScript(text) {
  return `(() => {
    ${DOM_HELPERS}
    const element = [...document.querySelectorAll('button')]
      .find((candidate) => isVisibleElement(candidate)
        && !candidate.disabled
        && String(candidate.innerText || '').trim() === ${JSON.stringify(text)});
    return element ? centerOf(element, true) : null;
  })()`;
}

export function fieldElementPointScript(selector, childSelector) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    const element = root?.querySelector(${JSON.stringify(childSelector)});
    if (!element) return null;
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    const points = [
      [0.5, 0.5],
      [0.15, 0.5],
      [0.85, 0.5],
      [0.5, 0.2],
      [0.5, 0.8],
    ];
    for (const [xRatio, yRatio] of points) {
      const x = rect.left + rect.width * xRatio;
      const y = rect.top + rect.height * yRatio;
      const hit = document.elementFromPoint(x, y);
      if (hit === element || element.contains(hit)) return { x, y };
    }
    return null;
  })()`;
}

export function pickerHeaderTextsScript(selector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    return [...(root?.querySelectorAll('.ud__picker-panel-header-btn') || [])]
      .map((element) => String(element.textContent || '').trim());
  })()`;
}

export function pickerHeaderButtonPointScript(selector, patternSource) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    const element = [...(root?.querySelectorAll('.ud__picker-panel-header-btn') || [])]
      .find((item) => ${patternSource}.test(String(item.textContent || '').trim()));
    return element ? centerOf(element) : null;
  })()`;
}

export function pickerCellPointScript(selector, text) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    const element = [...(root?.querySelectorAll('.ud__picker__cell-interactive-area') || [])]
      .find((item) => (
        !item.closest('.ud__picker__cell-outOfView')
        && isVisibleElement(item)
        && String(item.textContent || '').trim() === ${JSON.stringify(text)}
      ));
    return element ? centerOf(element) : null;
  })()`;
}

export function dateTimeInputValuesScript(selector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return null;
    const date = root.querySelector('.bitable-f9ce0c__calendar-picker-input');
    const time = root.querySelector('.bitable-f9ce0c__time-picker-input');
    return { date: date?.value || '', time: time?.value || '' };
  })()`;
}

export function datePickerVisibleScript(selector) {
  return `(() => {
    ${DOM_HELPERS}
    const root = document.querySelector(${JSON.stringify(selector)});
    const picker = root?.querySelector('.bitable-reminder-calendar-popover');
    return picker ? isVisibleElement(picker) : false;
  })()`;
}
