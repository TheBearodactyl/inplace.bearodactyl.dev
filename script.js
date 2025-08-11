(function () {
  const editor = document.getElementById("editor");
  const lineNumbers = document.getElementById("lineNumbers");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const copyBtn = document.getElementById("copyBtn");
  const formatBtn = document.getElementById("formatBtn");
  const validateBtn = document.getElementById("validateBtn");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const charCount = document.getElementById("charCount");

  const htmlLikeRegex =
    /<([a-zA-Z][^\s>\/]*)(?:\s+([^>]*))?>([\s\S]*?)<\/\1\s*>|<([a-zA-Z][^\s>\/]*)(?:\s+([^>]*))?\/\s*>/;

  editor.innerHTML = "<p><br></p>";

  let history = [];
  let historyIndex = -1;
  let isHistoryAction = false;

  function saveToHistory() {
    if (isHistoryAction) return;

    const content = editor.innerHTML;
    if (historyIndex === -1 || history[historyIndex] !== content) {
      history = history.slice(0, historyIndex + 1);
      history.push(content);
      historyIndex++;

      if (history.length > 50) {
        history.shift();
        historyIndex--;
      }
    }
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function undo() {
    if (historyIndex > 0) {
      isHistoryAction = true;
      historyIndex--;
      editor.innerHTML = history[historyIndex];
      updateHistoryButtons();
      updateLineNumbers();
      updateCharCount();
      setTimeout(() => {
        isHistoryAction = false;
      }, 10);
    }
  }

  function redo() {
    if (historyIndex < history.length - 1) {
      isHistoryAction = true;
      historyIndex++;
      editor.innerHTML = history[historyIndex];
      updateHistoryButtons();
      updateLineNumbers();
      updateCharCount();
      setTimeout(() => {
        isHistoryAction = false;
      }, 10);
    }
  }

  function validateTagBalance(str) {
    const withoutSelfClosing = str.replace(/<[^>]+\/\s*>/g, "");
    const withoutComments = withoutSelfClosing.replace(/<!--[\s\S]*?-->/g, "");

    const stack = [];
    const tagRegex = /<\/?([a-zA-Z][^\s>\/]*)[^>]*>/g;
    let match;

    while ((match = tagRegex.exec(withoutComments)) !== null) {
      const tagName = match[1].toLowerCase();
      const isClosing = match[0].startsWith("</");

      if (isClosing) {
        if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
          return {
            valid: false,
            error: `Unmatched closing tag: ${tagName}`,
          };
        }
        stack.pop();
      } else {
        const selfClosing = [
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "link",
          "meta",
          "param",
          "source",
          "track",
          "wbr",
        ];
        if (!selfClosing.includes(tagName)) {
          stack.push(tagName);
        }
      }
    }

    if (stack.length > 0) {
      return {
        valid: false,
        error: `Unclosed tags: ${stack.join(", ")}`,
      };
    }

    return { valid: true };
  }

  function sanitizeFragment(doc) {
    const scripts = doc.querySelectorAll("script");
    scripts.forEach((s) => s.remove());

    Array.from(doc.querySelectorAll("*")).forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        if (
          attr.name.toLowerCase() === "href" &&
          /^javascript:/i.test(attr.value)
        )
          el.removeAttribute(attr.name);
      });
    });
    return doc;
  }

  function parseFragment(str) {
    const validation = validateTagBalance(str);
    if (!validation.valid) {
      showToast(validation.error, "error");
      return null;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<div id="__wrap__">' + str + "</div>",
      "text/html"
    );
    const wrap = doc.getElementById("__wrap__");
    if (!wrap) return null;

    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      showToast("HTML parsing error detected", "error");
      return null;
    }

    sanitizeFragment(wrap);
    const frag = document.createDocumentFragment();
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    return frag;
  }

  function markNonEditable(el) {
    if (!(el && el.nodeType === Node.ELEMENT_NODE)) return;

    el.setAttribute("contenteditable", "false");
    el.dataset.liveHtml = "1";
    el.dataset.tagName = el.tagName.toLowerCase();
    el.classList.add("live-html");

    if (el.tagName.toLowerCase() === "a") {
      el.setAttribute("rel", "noopener");
      el.setAttribute("target", "_blank");
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        placeCaretAfterNode(el);
      });
    }

    Array.from(el.querySelectorAll("*")).forEach((child) =>
      child.setAttribute("contenteditable", "false")
    );
  }

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      if (!text.trim()) return false;

      let m;
      while ((m = htmlLikeRegex.exec(text)) !== null) {
        const tagContent = m[0];
        const validation = validateTagBalance(tagContent);

        if (validation.valid) {
          const start = m.index;
          const end = start + tagContent.length;
          const before = text.slice(0, start);
          const after = text.slice(end);
          const parent = node.parentNode;

          if (before)
            parent.insertBefore(document.createTextNode(before), node);

          const frag = parseFragment(tagContent);
          if (frag) {
            const nodes = Array.from(frag.childNodes);
            parent.insertBefore(frag, node);
            nodes.forEach((n) => {
              if (n.nodeType === Node.ELEMENT_NODE) markNonEditable(n);
            });
            const spacer = document.createTextNode(" ");
            parent.insertBefore(spacer, node);
          } else {
            parent.insertBefore(document.createTextNode(tagContent), node);
          }

          if (after) {
            const afterNode = document.createTextNode(after);
            parent.insertBefore(afterNode, node);
            node = afterNode;
          }

          parent.removeChild(node);
          return true;
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.isContentEditable === false) return false;
      const children = Array.from(node.childNodes);
      for (const c of children) {
        if (processNode(c)) return true;
      }
    }
    return false;
  }

  function ensureParagraphs() {
    const children = Array.from(editor.childNodes);
    for (const ch of children) {
      if (ch.nodeType === Node.TEXT_NODE && ch.textContent.trim()) {
        const p = document.createElement("p");
        p.appendChild(ch.cloneNode(true));
        editor.replaceChild(p, ch);
      } else if (
        ch.nodeType === Node.ELEMENT_NODE &&
        ch.tagName.toLowerCase() !== "p"
      ) {
        const block = [
          "div",
          "p",
          "ul",
          "ol",
          "table",
          "section",
          "header",
          "footer",
          "article",
          "pre",
          "blockquote",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "nav",
          "aside",
          "main",
          "figure",
          "figcaption",
          "details",
          "summary",
        ];
        if (!block.includes(ch.tagName.toLowerCase())) {
          const p = document.createElement("p");
          p.appendChild(ch.cloneNode(true));
          editor.replaceChild(p, ch);
        }
      }
    }
    if (!editor.querySelector("p") || editor.innerHTML.trim() === "") {
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      editor.appendChild(p);
    }
  }

  function processAll() {
    statusText.textContent = "Processing...";
    statusDot.className = "status-dot";

    let iterations = 0;
    let changed = false;
    const maxIterations = 20;

    do {
      changed = processNode(editor);
      iterations++;
    } while (changed && iterations < maxIterations);

    ensureParagraphs();

    statusText.textContent = "Ready";
    statusDot.className = "status-dot";
  }

  function containsValidHTML(text) {
    const m = htmlLikeRegex.exec(text);
    if (!m) return false;

    const tagContent = m[0];
    const validation = validateTagBalance(tagContent);
    return validation.valid;
  }

  function updateLineNumbers() {
    const lineHeight = 14 * 1.45;
    let totalLines = 0;

    const children = Array.from(editor.children);

    if (children.length === 0) {
      totalLines = 1;
    } else {
      children.forEach((child) => {
        if (
          child.tagName === "P" ||
          child.style.display === "block" ||
          getComputedStyle(child).display === "block"
        ) {
          const childHeight = child.offsetHeight || lineHeight;
          const linesInChild = Math.max(1, Math.ceil(childHeight / lineHeight));
          totalLines += linesInChild;
        } else {
          totalLines += 1;
        }
      });
    }

    const editorHeight = editor.offsetHeight;
    const minVisibleLines = Math.ceil(editorHeight / lineHeight);
    totalLines = Math.max(totalLines, minVisibleLines);

    const numbers = [];
    for (let i = 1; i <= totalLines; i++) {
      numbers.push(i);
    }

    lineNumbers.textContent = numbers.join("\n");
    lineNumbers.scrollTop = editor.scrollTop;
  }

  function updateCharCount() {
    const text = editor.textContent || editor.innerText || "";
    charCount.textContent = `${text.length} chars`;
  }

  function showToast(message, type = "info") {
    const existingToast = document.querySelector(".toast");
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function placeCaretAtEnd(el) {
    if (!el || !el.focus) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function placeCaretAfterNode(node) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const after = node.nextSibling;
    if (after && after.nodeType === Node.TEXT_NODE) {
      range.setStart(after, 0);
    } else {
      const spacer = document.createTextNode(" ");
      node.parentNode.insertBefore(spacer, node.nextSibling);
      range.setStart(spacer, 1);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
  }

  function nodeBeforeCaret(range) {
    let sc = range.startContainer;
    let so = range.startOffset;
    if (sc.nodeType === Node.TEXT_NODE && so === 0) {
      return sc.previousSibling;
    } else if (sc.nodeType === Node.ELEMENT_NODE && so > 0) {
      return sc.childNodes[so - 1];
    }
    return null;
  }

  editor.addEventListener("scroll", () => {
    lineNumbers.scrollTop = editor.scrollTop;
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  clearBtn.addEventListener("click", () => {
    if (confirm("Clear all content?")) {
      editor.innerHTML = "<p><br></p>";
      saveToHistory();
      updateLineNumbers();
      updateCharCount();
      showToast("Content cleared", "success");
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(editor.innerHTML);
      showToast("Content copied to clipboard", "success");
    } catch (err) {
      showToast("Failed to copy content", "error");
    }
  });

  validateBtn.addEventListener("click", () => {
    const content = editor.textContent || "";
    const htmlMatches = content.match(/<[^>]+>/g);

    if (!htmlMatches) {
      showToast("No HTML tags found", "info");
      return;
    }

    const validation = validateTagBalance(content);
    if (validation.valid) {
      showToast("HTML is valid!", "success");
    } else {
      showToast(validation.error, "error");
    }
  });

  editor.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
      }
    }

    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;
      const before = nodeBeforeCaret(range);
      if (
        before &&
        before.nodeType === Node.ELEMENT_NODE &&
        before.dataset &&
        before.dataset.liveHtml === "1"
      ) {
        e.preventDefault();
        const parent = before.parentNode;
        const after = before.nextSibling;
        parent.removeChild(before);
        if (after && after.nodeType === Node.TEXT_NODE) {
          const newRange = document.createRange();
          const sel2 = window.getSelection();
          if (sel2) {
            newRange.setStart(after, 0);
            newRange.collapse(true);
            sel2.removeAllRanges();
            sel2.addRange(newRange);
          }
        } else {
          placeCaretAtEnd(editor);
        }
        saveToHistory();
      }
    }

    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    }

    if (e.key === "Enter") {
      setTimeout(() => {
        updateLineNumbers();
      }, 10);
    }
  });

  editor.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest("[data-live-html]");
      if (el) {
        placeCaretAfterNode(el);
      } else {
        editor.focus();
      }
    },
    true
  );

  let inputTimer = null;
  let saveTimer = null;

  editor.addEventListener("input", () => {
    clearTimeout(inputTimer);
    clearTimeout(saveTimer);

    updateCharCount();
    updateLineNumbers();

    inputTimer = setTimeout(() => {
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const text = range ? range.toString() : "";

      if (!text || !containsValidHTML(text)) {
        processAll();
      }

      updateLineNumbers();

      if (
        range &&
        range.startContainer &&
        editor.contains(range.startContainer)
      ) {
        try {
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (e) {
          placeCaretAtEnd(editor);
        }
      } else {
        placeCaretAtEnd(editor);
      }
    }, 150);

    saveTimer = setTimeout(() => {
      saveToHistory();
    }, 10);
  });

  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData(
      "text/plain"
    );

    if (document.execCommand) {
      document.execCommand("insertText", false, text);
    } else {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
    }

    setTimeout(() => {
      updateLineNumbers();
    }, 10);

    showToast("Content pasted", "success");
  });

  window.addEventListener("resize", () => {
    setTimeout(() => {
      updateLineNumbers();
    }, 100);
  });

  const resizeObserver = new ResizeObserver(() => {
    updateLineNumbers();
  });
  resizeObserver.observe(editor);

  const mutationObserver = new MutationObserver(() => {
    setTimeout(() => {
      updateLineNumbers();
    }, 10);
  });

  mutationObserver.observe(editor, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  saveToHistory();
  updateLineNumbers();
  updateCharCount();

  editor.addEventListener("focus", () => {
    document.body.classList.add("editor-focused");
  });

  editor.addEventListener("blur", () => {
    document.body.classList.remove("editor-focused");
  });

  function getAccurateLineCount() {
    const tempDiv = document.createElement("div");
    tempDiv.style.position = "absolute";
    tempDiv.style.left = "-9999px";
    tempDiv.style.top = "-9999px";
    tempDiv.style.width = editor.clientWidth + "px";
    tempDiv.style.fontFamily = getComputedStyle(editor).fontFamily;
    tempDiv.style.fontSize = getComputedStyle(editor).fontSize;
    tempDiv.style.lineHeight = getComputedStyle(editor).lineHeight;
    tempDiv.style.whiteSpace = "pre-wrap";
    tempDiv.style.wordWrap = "break-word";
    tempDiv.style.padding = getComputedStyle(editor).padding;

    tempDiv.innerHTML = editor.innerHTML;
    document.body.appendChild(tempDiv);

    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    const actualHeight = tempDiv.offsetHeight;
    const calculatedLines = Math.max(1, Math.ceil(actualHeight / lineHeight));

    document.body.removeChild(tempDiv);

    return calculatedLines;
  }

  function updateLineNumbers() {
    try {
      let lineCount;

      if (
        editor.innerHTML.trim() === "" ||
        editor.innerHTML === "<p><br></p>"
      ) {
        lineCount = 1;
      } else {
        lineCount = getAccurateLineCount();
      }

      const lineHeight =
        parseFloat(getComputedStyle(editor).lineHeight) || 14 * 1.45;
      const visibleLines = Math.ceil(editor.clientHeight / lineHeight);
      lineCount = Math.max(lineCount, visibleLines);

      const numbers = [];
      for (let i = 1; i <= lineCount; i++) {
        numbers.push(i);
      }

      lineNumbers.textContent = numbers.join("\n");

      lineNumbers.scrollTop = editor.scrollTop;
    } catch (error) {
      console.warn("Error updating line numbers:", error);
      const fallbackCount = Math.max(1, editor.children.length || 1);
      const numbers = [];
      for (let i = 1; i <= fallbackCount; i++) {
        numbers.push(i);
      }
      lineNumbers.textContent = numbers.join("\n");
    }
  }

  window.liveHtmlEditor = {
    processAll,
    editor,
    undo,
    redo,
    saveToHistory,
    showToast,
    updateLineNumbers,
  };
})();
