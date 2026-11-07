const SCRIPT = document.currentScript;
const BASE = SCRIPT.dataset.base || "./";
const ADMIN = SCRIPT.dataset.mode === "admin";
const app = document.getElementById("app");
let timer = null, playing = false, rate = 0.6, fileSlow = true;
let playMode = localStorage.getItem("playMode") === "device" ? "device" : "file";
const GERMAN_PRONUNCIATIONS = {
  standard: "標準ドイツ語",
  northern: "北部ドイツ語",
  southern: "南部ドイツ語",
};

function errorHtml(text, detail) {
  return `<div class="error">${esc(text)}${detail ? `<small>（詳細: ${esc(detail)}）</small>` : ""}</div>`;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchOptionalJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function showSpeechMessage(text) {
  let box = document.getElementById("speechMsg");
  if (!box) return;
  box.innerHTML = text ? errorHtml(text) : "";
}

function pronunciationLabel(audio) {
  const condition = audio?.pronunciation;
  return condition && GERMAN_PRONUNCIATIONS[condition]
    ? GERMAN_PRONUNCIATIONS[condition] : "";
}

let adminFilter = "";

// 演奏会ページ: 同じフォルダの concert.json の曲だけを順番どおりに表示する。無ければ全曲。
async function loadConcert() {
  try {
    return await fetchJson("concert.json");
  } catch (e) {
    return null;
  }
}

async function loadConcerts() {
  const list = await fetchJson(BASE + "concerts.json").catch(() => []);
  return Promise.all(list.map(async c => ({
    ...c,
    songs: (await fetchJson(`${BASE}${encodeURIComponent(c.slug)}/concert.json`).catch(() => ({ songs: [] }))).songs || [],
  })));
}

async function showList() {
  stop();
  let catalog, concert = null, concerts = [];
  try {
    catalog = await fetchJson(BASE + "songs/index.json");
    if (ADMIN) concerts = await loadConcerts();
    else concert = await loadConcert();
  } catch (e) {
    app.innerHTML = errorHtml("曲の一覧を読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。", e.message);
    return;
  }
  let songs = catalog;
  if (concert) {
    const byId = new Map(catalog.map(s => [s.id, s]));
    songs = (concert.songs || []).map(id => byId.get(id)).filter(Boolean);
    document.getElementById("concertTitle").textContent = concert.title || "";
    if (concert.title) document.title = `${concert.title} - SingingPronunciationLab`;
  }
  app.innerHTML = "";
  if (ADMIN) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const sel = document.createElement("select");
    const options = [["", "すべての曲"], ["__none", "未割当の曲"], ["__dup", "重複曲(複数の演奏会)"],
      ...concerts.map(c => [c.slug, `${c.title || c.slug}(${c.songs.length}曲)`])];
    for (const [v, t] of options) sel.add(new Option(t, v));
    sel.value = adminFilter;
    sel.onchange = () => { adminFilter = sel.value; showList(); };
    bar.appendChild(sel);
    app.appendChild(bar);
    const links = document.createElement("div");
    links.className = "bar";
    for (const c of concerts) {
      const a = document.createElement("a");
      a.href = `${BASE}${encodeURIComponent(c.slug)}/`;
      a.textContent = `${c.title || c.slug} ↗`;
      links.appendChild(a);
    }
    app.appendChild(links);
    const membership = id => concerts.filter(c => c.songs.includes(id));
    songs = songs.filter(s => {
      const n = membership(s.id).length;
      if (adminFilter === "__none") return n === 0;
      if (adminFilter === "__dup") return n > 1;
      return !adminFilter || concerts.find(c => c.slug === adminFilter)?.songs.includes(s.id);
    });
    songs = songs.map(s => ({ ...s, concerts: membership(s.id).map(c => c.title || c.slug) }));
  }
  if (!songs.length) app.insertAdjacentHTML("beforeend", "<p>曲がまだありません</p>");
  for (const s of songs) {
    const b = document.createElement("button");
    b.className = "song";
    b.textContent = `${s.title}　${s.artist}（${s.language}）`;
    if (ADMIN) {
      const badge = document.createElement("small");
      badge.className = "badge";
      badge.textContent = s.concerts.length ? ` [${s.concerts.join(" / ")}]` : " [未割当]";
      b.appendChild(badge);
    }
    b.onclick = () => showSong(s.id);
    app.appendChild(b);
  }
}

async function showSong(id) {
  stop();
  let d;
  try {
    d = await fetchJson(`${BASE}songs/${encodeURIComponent(id)}.json`);
  } catch (e) {
    app.innerHTML = `<div class="bar"><button class="sub" id="back">← 一覧</button></div>`
      + errorHtml("曲のデータを読み込めませんでした。通信状況を確認して、もう一度お試しください。", e.message);
    document.getElementById("back").onclick = showList;
    return;
  }
  if (!d.audio && !location.hostname.endsWith("github.io")) {
    try {
      d.audio = await fetchJson(`/local/songs/${encodeURIComponent(id)}.audio.json`);
    } catch (e) { /* ローカル確認用の音声が無ければ従来どおり */ }
  }
  let grammar = null, grammarError = "";
  try {
    grammar = await fetchOptionalJson(`${BASE}songs/${encodeURIComponent(id)}.grammar.json`);
  } catch (e) {
    grammarError = `文法説明を読み込めませんでした: ${e.message}`;
  }
  const grammarIsValid = grammar && Array.isArray(grammar.lines)
    && grammar.lines.length === d.lines.length
    && grammar.lines.every((line, i) => line
      && line.original === d.lines[i].original
      && line.translation === d.lines[i].translation
      && Array.isArray(line.tokens) && line.tokens.length > 0
      && line.tokens.every(token => token
        && ["word", "lemma", "part_of_speech", "grammar", "meaning"]
          .every(key => typeof token[key] === "string" && token[key].trim()))
      && line.tokens.map(token => token.word).join("\u0000")
        === line.original.trim().split(/\s+/).join("\u0000"));
  if (grammar && !grammarIsValid) {
    const missingLemma = Array.isArray(grammar.lines)
      && grammar.lines.some(line => Array.isArray(line?.tokens)
        && line.tokens.some(token => !token || typeof token.lemma !== "string" || !token.lemma.trim()));
    grammar = null;
    grammarError = missingLemma
      ? "文法説明JSONに単語の原型（lemma）情報がありません。生成ツールを最新版で起動し直し、この曲の文法説明を再生成してください。"
      : "文法説明データが曲の行構成と一致しません。生成ツールで再生成してください。";
  }
  app.innerHTML = `
    <div class="bar"><button class="sub" id="back">← 一覧</button></div>
    <h2>${esc(d.title)} <small>${esc(d.artist || "")}</small></h2>
    <aside class="notice">
      <p><strong>翻訳モデル：</strong>${esc(d.generation_model || "記録なし")}</p>
      <p><strong>音声合成モデル：</strong>${esc(d.audio?.model || "記録なし")}</p>
      ${pronunciationLabel(d.audio) ? `<p><strong>ドイツ語発音条件：</strong>${esc(pronunciationLabel(d.audio))}</p>` : ""}
      <p>翻訳はAIによる簡易訳です。文脈や詩的表現などを十分に反映できず、意味が不正確な場合があります。</p>
      <p>カタカナ表記は発音の目安です。カタカナでは原語の音やアクセントなどを正確に表現できず、実際の発音とは異なります。</p>
    </aside>
    ${grammarError ? errorHtml(grammarError) : ""}
    ${grammar ? `<div class="bar view-mode-buttons" role="group" aria-label="表示モード">
      <button id="normalModeButton" aria-pressed="true">通常</button>
      <button id="grammarModeButton" aria-pressed="false">文法</button></div>` : ""}
    <div id="normalMode">
      <div class="bar"><button id="playAll">▶ 発音再生</button>
      <button class="sub" id="stop">■ 停止</button></div>
      ${d.audio ? `<div class="bar"><label>再生方式 <select id="mode"><option value="file">音声ファイル</option><option value="device">端末の音声</option></select></label></div>` : ""}
      <div class="bar"><label id="rateWrap">速度 <input type="range" id="rate" min="0.2" max="1" step="0.1" value="${rate}"></label>
      <label id="fileSpeedWrap">速度 <select id="fileSpeed"><option value="n">標準</option><option value="s">ゆっくり</option></select></label></div>
      <div id="speechMsg"></div>
      <p class="hint">カタカナ・訳語をタップ: 行を再生 / 原文の単語をタップ: その単語を含む文節を再生</p><div id="lines"></div>
    </div>
    ${grammar ? `<section id="grammarMode" class="grammar-mode" hidden>
      <div class="bar grammar-nav"><button class="sub" id="firstSentence">|← 先頭文</button>
      <button class="sub" id="previousSentence">← 前の文</button>
      <span id="sentencePosition"></span><button id="nextSentence">次の文 →</button></div>
      <div id="grammarContent"></div>
    </section>` : ""}`;
  document.getElementById("back").onclick = showList;
  const box = document.getElementById("lines");
  d.lines.forEach((l, i) => {
    const el = document.createElement("div");
    el.className = "line";
    const original = document.createElement("div");
    original.className = "orig";
    if (/\s/.test(l.original.trim())) {
      const originalWords = l.original.trim().split(/\s+/);
      let wordIndex = 0;
      for (const part of l.original.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          original.appendChild(document.createTextNode(part));
        } else {
          const word = document.createElement("span");
          word.className = "word";
          word.textContent = part;
          const index = wordIndex++;
          word.addEventListener("click", event => {
            event.stopPropagation();
            stop();
            const aline = d.audio?.lines?.[i];
            if (useFile(d) && d.audio?.phrases === false) return;
            if (aline?.phrases) {
              const p = aline.phrases.find(p => index >= p.start && index <= p.end);
              if (p) {
                speakText(d, i, originalWords.slice(p.start, p.end + 1).join(" "), undefined, p);
                return;
              }
            }
            if (aline && !aline.pairs) {
              speak(d, i);
              return;
            }
            if (index === 0) {
              speak(d, i);
              return;
            }
            speakText(d, i, `${originalWords[index - 1]} ${part}`, undefined, aline?.pairs?.[index]);
          });
          original.appendChild(word);
        }
      }
    } else {
      original.textContent = l.original;
    }
    const pronunciation = document.createElement("div");
    pronunciation.className = "pron";
    pronunciation.textContent = l.pronunciation;
    const translation = document.createElement("div");
    translation.className = "tran";
    translation.textContent = l.translation;
    el.append(original, pronunciation, translation);
    el.addEventListener("click", () => {
      stop();
      speak(d, i);
    });
    box.appendChild(el);
  });
  document.getElementById("stop").onclick = stop;
  document.getElementById("rate").oninput = e => rate = +e.target.value;
  document.getElementById("playAll").onclick = () => { stop(); playing = true; playFrom(d, 0); };
  const modeSel = document.getElementById("mode");
  const updateControls = () => {
    const file = useFile(d);
    document.getElementById("rateWrap").hidden = file;
    document.getElementById("fileSpeedWrap").hidden = !file || singleSpeed(d);
  };
  if (modeSel) {
    modeSel.value = playMode;
    modeSel.onchange = () => {
      playMode = modeSel.value;
      localStorage.setItem("playMode", playMode);
      stop();
      showSpeechMessage("");
      updateControls();
    };
  }
  document.getElementById("fileSpeed").value = fileSlow ? "s" : "n";
  document.getElementById("fileSpeed").onchange = e => fileSlow = e.target.value === "s";
  updateControls();
  if (grammar) {
    let sentenceIndex = 0;
    const grammarContent = document.getElementById("grammarContent");
    const renderGrammarLine = () => {
      const line = grammar.lines[sentenceIndex];
      const card = document.createElement("article");
      card.className = "grammar-card";
      const original = document.createElement("div");
      original.className = "orig";
      original.textContent = line.original;
      const translation = document.createElement("div");
      translation.className = "tran grammar-translation";
      translation.textContent = d.lines[sentenceIndex].translation;
      const heading = document.createElement("h3");
      heading.textContent = "単語の分解";
      const tableWrap = document.createElement("div");
      tableWrap.className = "grammar-table-wrap";
      const table = document.createElement("table");
      table.className = "grammar-table";
      const header = document.createElement("tr");
      for (const label of ["単語（原型）", "品詞", "文法・格", "意味"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        header.appendChild(cell);
      }
      const thead = document.createElement("thead");
      thead.appendChild(header);
      const tbody = document.createElement("tbody");
      for (const token of line.tokens) {
        const row = document.createElement("tr");
        const displayedWord = token.word === token.lemma
          ? token.word : `${token.word}（${token.lemma}）`;
        for (const value of [displayedWord, token.part_of_speech, token.grammar, token.meaning]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
        tbody.appendChild(row);
      }
      table.append(thead, tbody);
      tableWrap.appendChild(table);
      card.append(original, translation, heading, tableWrap);
      
      // クリックハンドラを追加（原語・翻訳をクリックで音声再生）
      original.addEventListener("click", (event) => {
        event.stopPropagation();
        stop();
        speak(d, sentenceIndex);
      });
      translation.addEventListener("click", (event) => {
        event.stopPropagation();
        stop();
        speak(d, sentenceIndex);
      });
      
      grammarContent.replaceChildren(card);
      document.getElementById("sentencePosition").textContent =
        `${sentenceIndex + 1} / ${grammar.lines.length}`;
      document.getElementById("firstSentence").disabled = sentenceIndex === 0;
      document.getElementById("previousSentence").disabled = sentenceIndex === 0;
      document.getElementById("nextSentence").disabled = sentenceIndex === grammar.lines.length - 1;
    };
    document.getElementById("firstSentence").onclick = () => {
      sentenceIndex = 0;
      renderGrammarLine();
    };
    document.getElementById("previousSentence").onclick = () => {
      if (sentenceIndex > 0) sentenceIndex--;
      renderGrammarLine();
    };
    document.getElementById("nextSentence").onclick = () => {
      if (sentenceIndex < grammar.lines.length - 1) sentenceIndex++;
      renderGrammarLine();
    };
    const setViewMode = isGrammar => {
      if (isGrammar) stop();
      document.getElementById("normalMode").hidden = isGrammar;
      document.getElementById("grammarMode").hidden = !isGrammar;
      document.getElementById("normalModeButton").setAttribute("aria-pressed", String(!isGrammar));
      document.getElementById("grammarModeButton").setAttribute("aria-pressed", String(isGrammar));
      if (isGrammar) renderGrammarLine();
    };
    document.getElementById("normalModeButton").onclick = () => setViewMode(false);
    document.getElementById("grammarModeButton").onclick = () => setViewMode(true);
  }
}

function useFile(d) {
  return !!d.audio && playMode === "file";
}

// 速度が1種類だけの曲は切替を出さず、その速度で再生する
function singleSpeed(d) {
  const speeds = d.audio?.speeds;
  return Array.isArray(speeds) && speeds.length === 1 ? speeds[0] : null;
}

const player = new Audio();
player.preload = "auto";

function clipUrl(clip) {
  const first = fileSlow ? "s" : "n";
  return clip[first] || clip[fileSlow ? "n" : "s"];
}

function playClip(clip, onend) {
  const url = clipUrl(clip);
  player.onended = onend || null;
  player.onerror = () => {
    playing = false;
    showSpeechMessage("音声ファイルを再生できませんでした。通信状況をご確認ください。「端末の音声」に切り替えてもお試しいただけます。");
  };
  player.src = url;
  player.play().then(() => showSpeechMessage("")).catch(e => {
    if (e.name === "AbortError") return;
    playing = false;
    showSpeechMessage("音声ファイルを再生できませんでした。通信状況をご確認ください。");
  });
}

function prefetch(d, i) {
  const clip = useFile(d) && d.audio.lines[i];
  if (clip) fetch(clipUrl(clip), { mode: "no-cors" }).catch(() => {});
}

function speak(d, i, onend) {
  speakText(d, i, d.lines[i].original, onend, d.audio?.lines?.[i]);
}

function speakText(d, i, text, onend, clip) {
  const grammarMode = document.getElementById("grammarMode");
  const isGrammarVisible = grammarMode && !grammarMode.hidden;
  const els = document.querySelectorAll(".line");
  els.forEach(e => e.classList.remove("active"));
  if (els[i]) {
    els[i].classList.add("active");
    if (!isGrammarVisible) {
      els[i].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  const grammarCard = document.querySelector(".grammar-card");
  if (grammarCard) {
    grammarCard.classList.add("active");
  }
  
  const resetGrammarCardBg = () => {
    if (grammarCard) grammarCard.classList.remove("active");
  };
  const wrappedOnend = () => {
    resetGrammarCardBg();
    if (onend) onend();
  };
  
  if (useFile(d) && clip) {
    playClip(clip, wrappedOnend);
    return;
  }
  if (!("speechSynthesis" in window)) {
    showSpeechMessage("このブラウザは音声再生に対応していません。ChromeやEdgeなど別のブラウザでお試しください。");
    playing = false;
    return;
  }
  const isLatin = d.lang_code.toLowerCase() === "la";
  const speechLang = isLatin ? "it-IT" : d.lang_code;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLang;
  const voices = speechSynthesis.getVoices();
  const lang = speechLang.toLowerCase();
  const voice = voices.find(v => v.lang.toLowerCase().replace("_", "-") === lang)
    || voices.find(v => v.lang.toLowerCase().replace("_", "-").split("-")[0] === lang.split("-")[0])
    || null;
  u.voice = voice;
  if (voice) {
    showSpeechMessage(isLatin ? "教会ラテン語に近い発音を目指し、端末のイタリア語音声で再生しています。" : "");
  } else if (voices.length) {
    showSpeechMessage(isLatin
      ? "この端末にイタリア語音声がないため、教会ラテン語に近い発音で再生できない場合があります。端末の設定でイタリア語音声を追加してください。"
      : `この端末には${d.language || "この言語"}の音声が入っていないため、音が出ない、または正しく読み上げられない場合があります。端末の設定で音声データを追加してください。`);
  } else if (isLatin) {
    showSpeechMessage("教会ラテン語に近い発音を目指し、端末のイタリア語音声で再生します。イタリア語音声がない場合は発音が異なることがあります。");
  }
  u.rate = rate;
  u.onend = wrappedOnend;
  u.onerror = e => {
    if (e.error === "canceled" || e.error === "interrupted") return;
    playing = false;
    showSpeechMessage("音声を再生できませんでした。端末の音量や、音声データの追加をご確認ください。");
    resetGrammarCardBg();
  };
  speechSynthesis.speak(u);
}

if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
}

function playFrom(d, i) {
  if (!playing || i >= d.lines.length) { playing = false; return; }
  speak(d, i, () => { timer = setTimeout(() => playFrom(d, i + 1), 300); });
  prefetch(d, i + 1);
}

function stop() {
  playing = false;
  clearTimeout(timer);
  player.onended = null;
  player.pause();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

showList();
