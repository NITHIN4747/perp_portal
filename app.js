/* ================================================================
   InterviewAce — app.js
   Core application logic: routing, parsing, quiz engine,
   analytics, PDF generation, history management.
   ================================================================ */

// ---- PDF.js worker ----
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

/* ================================================================
   STATE
   ================================================================ */
const state = {
  allQuestions: [],          // full parsed bank
  quizQuestions: [],         // subset for current quiz
  currentIndex: 0,
  answers: [],               // { chosen, correct, timeTaken, skipped }
  timer: null,
  timeLeft: 60,
  quizStartTime: null,
  questionStartTime: null,
  quizActive: false,
  settings: {
    numQ: 10,
    timePerQ: 60,
    shuffle: true,
    shuffleOpts: false,
    showAnswer: false,
    mode: 'exam',
    apiKey: '',
  },
  sessions: [],              // history
  lastSession: null,
  doughnutChart: null,
  barChart: null,
};

/* ================================================================
   NAVIGATION
   ================================================================ */
function navigate(sectionId) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('sec-' + sectionId);
  if (sec) sec.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (nav) nav.classList.add('active');
  closeSidebar();
  if (sectionId === 'analytics') renderAnalytics();
  if (sectionId === 'results') renderHistory();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

/* ================================================================
   FILE UPLOAD & PARSING
   ================================================================ */
const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('fileInput');

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf','docx','doc'].includes(ext)) {
    showParseError('Unsupported file type. Please upload a PDF or DOCX file.');
    return;
  }
  showProgress(0, 'Reading file…');
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      showProgress(20, 'File loaded, parsing content…');
      let text = '';
      if (ext === 'pdf') {
        text = await parsePDF(e.target.result);
      } else {
        text = await parseDOCX(e.target.result);
      }
      showProgress(70, 'Extracting questions…');
      const questions = extractQuestions(text);
      showProgress(100, `Found ${questions.length} questions!`);
      if (questions.length === 0) {
        showParseError('No questions detected. Please check the format guide below and try again.');
        return;
      }
      setTimeout(() => showParsedPreview(questions), 400);
    } catch(err) {
      showParseError('Failed to parse file: ' + err.message);
    }
  };
  reader.onerror = () => showParseError('Could not read the file.');
  reader.readAsArrayBuffer(file);
}

async function parsePDF(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ 
    data: arrayBuffer,
    standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
    cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true,
  }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      pageText += item.str + (item.hasEOL ? '\n' : '');
    }
    fullText += pageText + '\n';
  }
  return fullText;
}

async function parseDOCX(arrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/* ================================================================
   QUESTION EXTRACTOR
   ================================================================ */
function extractQuestions(text) {
  const questions = [];

  // Normalise line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Condense multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  /* ---- Strategy: Split on question patterns ---- */
  // Patterns: "Q1.", "1.", "Q1)", "1)", "Question 1"
  const qPattern = /(?:^|\n)\s*(?:Q(?:uestion)?\s*\.?\s*)?(\d+)[.)]\s+(.+?)(?=\n\s*(?:Q(?:uestion)?\s*\.?\s*)?\d+[.)]\s|\n*$)/gis;

  let blocks = [];
  // Try block splitting by question numbers
  const lines = text.split('\n');
  let currentBlock = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect question start — supported patterns:
    //   "Q03 text"   (Q prefix, no period)       ← Mphasis 100Q style
    //   "Q13. text"  (Q prefix, with period)
    //   "13. text"   (plain number + period)
    //   "13) text"   (plain number + paren)
    // Guard: isOptionLine() prevents A/B/C/D lines matching
    const qMatchA = !isOptionLine(line) && line.match(/^Q(?:uestion)?\s*(\d+)(?:[.)]\s+|\s+)(.+)/i);
    const qMatchB = !isOptionLine(line) && !qMatchA && line.match(/^(\d+)[.)]\s+(.+)/i);
    const qMatch  = qMatchA || qMatchB;
    if (qMatch) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { num: parseInt(qMatch[1]), lines: [line] };
      continue;
    }


    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  // If no blocks found, try "Q:" format
  if (blocks.length === 0) {
    const qColonPattern = text.split(/\n(?=Q\s*:)/i);
    qColonPattern.forEach((block, idx) => {
      blocks.push({ num: idx + 1, lines: block.split('\n').map(l=>l.trim()).filter(Boolean) });
    });
  }

  for (const block of blocks) {
    const q = parseQuestionBlock(block.lines, block.num);
    if (q) questions.push(q);
  }

  // Fallback: if very few questions, try different approach
  if (questions.length < 2) {
    return extractQuestionsAlt(text);
  }

  return questions;
}

function isOptionLine(line) {
  // Matches: "A. text", "A) text", "a. text", "1. text" etc.
  return /^[A-Da-d1-4][.)][\s]+\S/i.test(line.trim());
}

function parseQuestionBlock(lines, num) {
  if (!lines || lines.length < 2) return null;

  let questionText = '';
  const options = [];
  let correctAnswer = '';
  let foundOptions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Option line: "A. text", "A) text", "a. text", "1. text"
    // Require at least one whitespace after the period/paren to avoid false matches
    const optMatch = line.match(/^([A-Da-d1-4])[.)][ \t]+(.+)/);
    if (optMatch) {
      const optLetter = optMatch[1].toUpperCase();
      let optText = optMatch[2].trim();
      // Inline correct markers: trailing * or (correct)
      const isInlineCorrect = optText.endsWith('*') || /\(correct\)/i.test(optText);
      if (isInlineCorrect) {
        optText = optText.replace(/\*$/, '').replace(/\(correct\)/i, '').trim();
        correctAnswer = optLetter;
      }
      options.push({ letter: optLetter, text: optText });
      foundOptions = true;
      continue;
    }

    // Answer line — all known formats:
    // "Answer: B", "Correct: B", "Ans: B", "Key: B", "Answer Key: B"
    // "✓ Correct option: B", "Correct option: B" (Mphasis/Wipro style)
    // Note: PDF.js sometimes extracts '✓' as '3' or a weird symbol if fonts fail.
    const ansMatch = line.match(
      /^(?:[✓✔√\*\d\W]+)?\s*(?:correct\s*(?:option|answer|ans)?|answer\s*(?:key)?|ans(?:wer)?|key)\s*[:\-]?\s*([A-Da-d1-4])(?:[.)]|$)/i
    );
    if (ansMatch) {
      correctAnswer = ansMatch[1].toUpperCase();
      continue;
    }

    // If not option/answer line, it is question text (accumulate until options start)
    if (!foundOptions) {
      // Strip leading question number in all formats:
      //   "Q03 text", "Q13. text", "13. text", "13) text"
      let stripped = line
        .replace(/^Q(?:uestion)?\s*\d+(?:[.)][ \t]+|\s+)/i, '')
        .replace(/^\d+[.)][ \t]+/i, '')
        .trim();

      // ── Inline answer on question line: "... text   Correct: C" (right-aligned in PDF)
      // Handles: "Correct: C", "Correct:C", with optional leading spaces/tabs
      const inlineAns = stripped.match(/[\s\t]{2,}Correct:\s*([A-Da-d])\s*$/i)
                     || stripped.match(/\s+Correct:\s*([A-Da-d])\s*$/i);
      if (inlineAns) {
        correctAnswer = inlineAns[1].toUpperCase();
        stripped = stripped.replace(/[\s\t]+Correct:\s*[A-Da-d]\s*$/i, '').trim();
      }

      if (stripped) questionText += (questionText ? ' ' : '') + stripped;
    }
  }

  // Map numeric options to letters
  const letterMap = { '1':'A','2':'B','3':'C','4':'D' };
  options.forEach(o => { if(letterMap[o.letter]) o.letter = letterMap[o.letter]; });
  if(letterMap[correctAnswer]) correctAnswer = letterMap[correctAnswer];

  if (!questionText || options.length < 2) return null;

  return {
    id: num,
    question: questionText,
    options,
    correct: correctAnswer || (options[0] ? options[0].letter : ''),
  };
}

// Alternative extraction (more aggressive regex)
function extractQuestionsAlt(text) {
  const questions = [];
  // Split on "Q:" or "Question:"
  const segments = text.split(new RegExp('\\n(?=(?:Q\\s*\\d*\\s*[:.=]|Question\\s*\\d*\\s*[:.=]|\\d+\\.\\s+\\S))', 'i'));

  segments.forEach((seg, idx) => {
    const lines = seg.split('\n').map(l => l.trim()).filter(Boolean);
    const q = parseQuestionBlock(lines, idx + 1);
    if (q) questions.push(q);
  });
  return questions;
}

/* ================================================================
   UPLOAD UI
   ================================================================ */
function showProgress(pct, label) {
  document.getElementById('uploadProgress').classList.remove('hidden');
  document.getElementById('parsedPreview').classList.add('hidden');
  document.getElementById('parseError').classList.add('hidden');
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = label;
}

function showParsedPreview(questions) {
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('parsedPreview').classList.remove('hidden');
  document.getElementById('parsedCount').textContent = questions.length + ' questions';

  const tbody = document.getElementById('previewTbody');
  tbody.innerHTML = '';
  questions.slice(0, 50).forEach((q, i) => {
    const optStr = q.options.map(o => `${o.letter}) ${o.text}`).join('<br>');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${escHtml(q.question)}</td>
      <td style="font-size:0.78rem;color:var(--text2)">${optStr}</td>
      <td><span style="color:var(--teal);font-weight:700">${q.correct || '?'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (questions.length > 50) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="text-align:center;color:var(--text3);font-size:0.82rem;padding:12px">… and ${questions.length - 50} more questions</td>`;
    tbody.appendChild(tr);
  }

  // Store temporarily
  state._pendingQuestions = questions;
}

function showParseError(msg) {
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('parsedPreview').classList.add('hidden');
  document.getElementById('parseError').classList.remove('hidden');
  document.getElementById('parseErrorMsg').textContent = msg;
}

function confirmQuestions() {
  state.allQuestions = state._pendingQuestions || [];
  state._pendingQuestions = null;
  document.getElementById('sidebarQNum').textContent = state.allQuestions.length;
  document.getElementById('statTotalQ').textContent = state.allQuestions.length;
  updateSettingsMaxQ();
  toast(`✅ ${state.allQuestions.length} questions loaded successfully!`);
  navigate('settings');
}

function resetUpload() {
  document.getElementById('parsedPreview').classList.add('hidden');
  document.getElementById('parseError').classList.add('hidden');
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  state._pendingQuestions = null;
}

function updateSettingsMaxQ() {
  const el = document.getElementById('settingNumQ');
  if (state.allQuestions.length > 0) {
    el.max = state.allQuestions.length;
    if (parseInt(el.value) > state.allQuestions.length) {
      el.value = Math.min(state.settings.numQ, state.allQuestions.length);
    }
  }
}

/* ================================================================
   SETTINGS
   ================================================================ */
function setNumQ(n) {
  const max = state.allQuestions.length || 200;
  document.getElementById('settingNumQ').value = Math.min(n, max);
}
function setTimeQ(s) { document.getElementById('settingTimeQ').value = s; }

function saveSettings() {
  state.settings.numQ         = Math.max(1, parseInt(document.getElementById('settingNumQ').value) || 10);
  state.settings.timePerQ     = parseInt(document.getElementById('settingTimeQ').value) || 0;
  state.settings.shuffle      = document.getElementById('settingShuffle').checked;
  state.settings.shuffleOpts  = document.getElementById('settingShuffleOpts').checked;
  state.settings.showAnswer   = document.getElementById('settingShowAnswer').checked;
  state.settings.mode         = document.getElementById('settingMode').value;
  state.settings.apiKey       = document.getElementById('settingApiKey').value.trim();
  
  localStorage.setItem('ia_settings', JSON.stringify(state.settings));
  toast('⚙️ Settings saved!');
}

// Sync UI on load
function syncSettingsUI() {
  const saved = localStorage.getItem('ia_settings');
  if (saved) {
    try { Object.assign(state.settings, JSON.parse(saved)); } catch(e){}
  }
  
  document.getElementById('settingNumQ').value = state.settings.numQ;
  document.getElementById('settingTimeQ').value = state.settings.timePerQ;
  document.getElementById('settingShuffle').checked = state.settings.shuffle;
  document.getElementById('settingShuffleOpts').checked = state.settings.shuffleOpts;
  document.getElementById('settingShowAnswer').checked = state.settings.showAnswer;
  document.getElementById('settingMode').value = state.settings.mode;
  document.getElementById('settingApiKey').value = state.settings.apiKey;
}

/* ================================================================
   QUIZ ENGINE
   ================================================================ */
function startQuizFlow() {
  saveSettings();
  if (state.allQuestions.length === 0) {
    navigate('upload');
    toast('⚠️ Please upload a question bank first!');
    return;
  }
  navigate('quiz');
  initQuiz();
}

function initQuiz() {
  // Copy and optionally shuffle
  let pool = [...state.allQuestions];
  if (state.settings.shuffle) pool = shuffleArray(pool);

  const n = Math.min(state.settings.numQ, pool.length);
  state.quizQuestions = pool.slice(0, n).map(q => {
    let opts = [...q.options];
    if (state.settings.shuffleOpts) {
      const correctOpt = opts.find(o => o.letter === q.correct);
      opts = shuffleArray(opts);
      // Reassign letters A B C D
      const letters = ['A','B','C','D'];
      let newCorrect = '';
      opts = opts.map((o, i) => {
        const newLetter = letters[i] || String.fromCharCode(65+i);
        if (o.letter === q.correct || o === correctOpt) newCorrect = newLetter;
        return { ...o, letter: newLetter };
      });
      return { ...q, options: opts, correct: newCorrect };
    }
    return { ...q, options: opts };
  });

  state.currentIndex = 0;
  state.answers = Array(state.quizQuestions.length).fill(null).map(() => ({
    chosen: null, correct: null, timeTaken: 0, skipped: false
  }));
  state.quizActive = true;
  state.quizStartTime = Date.now();

  document.getElementById('quizNotStarted').classList.add('hidden');
  document.getElementById('quizInProgress').classList.remove('hidden');

  renderQuestion();
}

function renderQuestion() {
  if (state.currentIndex >= state.quizQuestions.length) {
    endQuiz();
    return;
  }
  const q = state.quizQuestions[state.currentIndex];
  const total = state.quizQuestions.length;
  const idx = state.currentIndex;

  // Header
  document.getElementById('qNum').textContent = `Q ${idx+1} / ${total}`;
  document.getElementById('quizProgressFill').style.width = ((idx / total) * 100) + '%';
  document.getElementById('questionNumBadge').textContent = `Q${idx+1}`;
  document.getElementById('questionText').textContent = q.question;

  // Options
  const grid = document.getElementById('optionsGrid');
  grid.innerHTML = '';
  q.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.letter = opt.letter;
    btn.innerHTML = `<span class="option-label">${opt.letter}</span><span>${escHtml(opt.text)}</span>`;
    btn.onclick = () => selectOption(opt.letter, btn);
    grid.appendChild(btn);
  });

  // Buttons
  document.getElementById('btnSkip').classList.remove('hidden');
  document.getElementById('btnNext').classList.add('hidden');
  document.getElementById('answerFeedback').classList.add('hidden');
  document.getElementById('answerFeedback').className = 'answer-feedback hidden card';
  document.getElementById('aiHintBox').classList.add('hidden');
  
  if (idx > 0) document.getElementById('btnPrev').classList.remove('hidden');
  else document.getElementById('btnPrev').classList.add('hidden');
  
  document.getElementById('btnHint').classList.remove('hidden');

  // Restore state if already answered or skipped
  const ans = state.answers[idx];
  if (ans.chosen || ans.skipped) {
    document.getElementById('btnSkip').classList.add('hidden');
    document.getElementById('btnNext').classList.remove('hidden');
    
    document.querySelectorAll('.option-btn').forEach(b => {
      b.disabled = true;
      if (ans.chosen) {
        if (b.dataset.letter === q.correct) b.classList.add('correct');
        if (b.dataset.letter === ans.chosen && ans.chosen !== q.correct) b.classList.add('wrong');
      }
    });

    if (state.settings.showAnswer || state.settings.mode === 'practice') {
      if (ans.skipped) showFeedback('skipped', q.correct, q.options);
      else showFeedback(ans.chosen === q.correct ? 'correct' : 'wrong', q.correct, q.options);
    }
    
    // Reset timer display visually
    document.getElementById('timerText').textContent = '—';
    document.getElementById('timerCircle').style.strokeDashoffset = '0';
    return;
  }

  // Timer
  startTimer(q);

  state.questionStartTime = Date.now();
}

function selectOption(letter, btn) {
  if (!state.quizActive) return;

  const q = state.quizQuestions[state.currentIndex];
  const timeTaken = Math.round((Date.now() - state.questionStartTime) / 1000);

  // Update answer record
  state.answers[state.currentIndex].chosen = letter;
  state.answers[state.currentIndex].correct = q.correct;
  state.answers[state.currentIndex].timeTaken = timeTaken;
  state.answers[state.currentIndex].skipped = false;

  // Disable all options
  document.querySelectorAll('.option-btn').forEach(b => {
    b.disabled = true;
    b.classList.remove('selected','correct','wrong');
    if (b.dataset.letter === q.correct) b.classList.add('correct');
    if (b.dataset.letter === letter && letter !== q.correct) b.classList.add('wrong');
    if (b.dataset.letter === letter && letter === q.correct) b.classList.add('correct');
  });

  // Clear existing selection and mark chosen
  btn.classList.add(letter === q.correct ? 'correct' : 'wrong');

  stopTimer();

  // Feedback
  if (state.settings.showAnswer || state.settings.mode === 'practice') {
    showFeedback(letter === q.correct ? 'correct' : 'wrong', q.correct, q.options);
  }

  document.getElementById('btnSkip').classList.add('hidden');
  document.getElementById('btnNext').classList.remove('hidden');
}

function skipQuestion() {
  const timeTaken = Math.round((Date.now() - state.questionStartTime) / 1000);
  state.answers[state.currentIndex].skipped = true;
  state.answers[state.currentIndex].timeTaken = timeTaken;
  state.answers[state.currentIndex].correct = state.quizQuestions[state.currentIndex].correct;
  stopTimer();
  if (state.settings.showAnswer || state.settings.mode === 'practice') {
    const q = state.quizQuestions[state.currentIndex];
    showFeedback('skipped', q.correct, q.options);
  }
  document.getElementById('btnSkip').classList.add('hidden');
  document.getElementById('btnNext').classList.remove('hidden');
}

function nextQuestion() {
  state.currentIndex++;
  renderQuestion();
}

function prevQuestion() {
  if (state.currentIndex > 0) {
    stopTimer();
    state.currentIndex--;
    renderQuestion();
  }
}

async function generateHint() {
  const key = state.settings.apiKey;
  if (!key) {
    alert("Please enter your Gemini API Key in the Settings page to use the AI Hint feature.");
    navigate('settings');
    return;
  }

  const hintBox = document.getElementById('aiHintBox');
  const hintContent = document.getElementById('aiHintContent');
  hintBox.classList.remove('hidden');
  hintContent.textContent = 'Generating hint with Gemini AI...';

  const q = state.quizQuestions[state.currentIndex];
  const optionsText = q.options.map(o => `${o.letter}) ${o.text}`).join('\n');
  
  const prompt = `You are an expert interview coach. Provide a clear, detailed explanation for the correct answer to this multiple-choice question.
If applicable, include any relevant shortcuts, tricks, or formulas that can help solve this type of problem quickly during an exam.

Question:
${q.question}

Options:
${optionsText}

Explanation, Shortcuts & Answer:`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.candidates[0].content.parts[0].text;
    hintContent.innerHTML = marked.parse(text);
    if (window.MathJax) {
      MathJax.typesetPromise([hintContent]).catch(err => console.error(err));
    }
  } catch(err) {
    hintContent.textContent = 'Failed to generate hint: ' + err.message;
  }
}

function showFeedback(type, correct, options) {
  const fb = document.getElementById('answerFeedback');
  fb.classList.remove('hidden','correct-fb','wrong-fb','skipped-fb');
  const icon = document.getElementById('feedbackIcon');
  const msg  = document.getElementById('feedbackMsg');
  const correctOpt = options.find(o => o.letter === correct);
  const correctText = correctOpt ? `${correct}) ${correctOpt.text}` : correct;

  if (type === 'correct') {
    fb.classList.add('correct-fb');
    icon.textContent = '✅';
    msg.textContent = 'Correct! Well done.';
  } else if (type === 'wrong') {
    fb.classList.add('wrong-fb');
    icon.textContent = '❌';
    msg.textContent = `Wrong. Correct answer: ${correctText}`;
  } else {
    fb.classList.add('skipped-fb');
    icon.textContent = '⏭';
    msg.textContent = `Skipped. Correct answer: ${correctText}`;
  }
}

function endQuizEarly() {
  if (!state.quizActive) return;
  stopTimer();
  // fill remaining as skipped
  for (let i = state.currentIndex; i < state.quizQuestions.length; i++) {
    if (!state.answers[i].chosen && !state.answers[i].skipped) {
      state.answers[i].skipped = true;
      state.answers[i].correct = state.quizQuestions[i].correct;
    }
  }
  endQuiz();
}

function endQuiz() {
  state.quizActive = false;
  stopTimer();

  document.getElementById('quizInProgress').classList.add('hidden');
  document.getElementById('quizNotStarted').classList.remove('hidden');
  document.getElementById('quizReadyMsg').textContent = 'Quiz complete! View your results in Analytics.';

  // Save session
  const totalTime = Math.round((Date.now() - state.quizStartTime) / 1000);
  const correct   = state.answers.filter(a => a.chosen && a.chosen === a.correct).length;
  const wrong     = state.answers.filter(a => a.chosen && a.chosen !== a.correct).length;
  const skipped   = state.answers.filter(a => a.skipped || !a.chosen).length;
  const score     = Math.round((correct / state.quizQuestions.length) * 100);

  const session = {
    date: new Date().toISOString(),
    numQ: state.quizQuestions.length,
    correct, wrong, skipped, score, totalTime,
    answers: JSON.parse(JSON.stringify(state.answers)),
    questions: JSON.parse(JSON.stringify(state.quizQuestions)),
  };
  state.sessions.unshift(session);
  state.lastSession = session;
  persistSessions();

  // Update home stats
  document.getElementById('statAttempts').textContent = state.sessions.length;
  const best = Math.max(...state.sessions.map(s => s.score));
  document.getElementById('statBestScore').textContent = best + '%';
  const avgT = Math.round(state.sessions.reduce((a,s) => a + s.totalTime / s.numQ, 0) / state.sessions.length);
  document.getElementById('statAvgTime').textContent = avgT + 's';

  showRecentSessions();
  toast('🎉 Quiz complete! Check Analytics for your results.');
  navigate('analytics');
}

/* ================================================================
   TIMER
   ================================================================ */
function startTimer(q) {
  stopTimer();
  const limit = state.settings.timePerQ;
  if (limit === 0) {
    document.getElementById('timerText').textContent = '∞';
    document.getElementById('timerCircle').style.strokeDashoffset = 0;
    document.getElementById('timerCircle').style.stroke = 'var(--teal)';
    document.getElementById('mobileTimer').classList.add('hidden');
    return;
  }

  state.timeLeft = limit;
  updateTimerUI(limit, limit);
  document.getElementById('mobileTimer').classList.remove('hidden');

  state.timer = setInterval(() => {
    state.timeLeft--;
    updateTimerUI(state.timeLeft, limit);
    if (state.timeLeft <= 0) {
      stopTimer();
      autoTimeoutQuestion();
    }
  }, 1000);
}

function updateTimerUI(left, total) {
  const pct = left / total;
  const circumference = 176; // 2*PI*28
  const offset = circumference * (1 - pct);
  const circle = document.getElementById('timerCircle');
  circle.style.strokeDashoffset = offset;
  if (pct > 0.5) circle.style.stroke = 'var(--teal)';
  else if (pct > 0.25) circle.style.stroke = 'var(--yellow)';
  else circle.style.stroke = 'var(--pink)';
  document.getElementById('timerText').textContent = left;
  document.getElementById('mobileTimer').textContent = left + 's';
}

function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}

function autoTimeoutQuestion() {
  // Auto-skip
  const timeTaken = state.settings.timePerQ;
  state.answers[state.currentIndex].skipped = true;
  state.answers[state.currentIndex].timeTaken = timeTaken;
  state.answers[state.currentIndex].correct = state.quizQuestions[state.currentIndex].correct;
  if (state.settings.showAnswer || state.settings.mode === 'practice') {
    const q = state.quizQuestions[state.currentIndex];
    showFeedback('skipped', q.correct, q.options);
  }
  document.getElementById('btnSkip').classList.add('hidden');
  document.getElementById('btnNext').classList.remove('hidden');
  toast('⏱️ Time up! Moving next…');
  setTimeout(() => nextQuestion(), 1200);
}

/* ================================================================
   ANALYTICS
   ================================================================ */
function renderAnalytics() {
  const session = state.lastSession;
  if (!session) {
    document.getElementById('analyticsEmpty').classList.remove('hidden');
    document.getElementById('analyticsContent').classList.add('hidden');
    return;
  }
  document.getElementById('analyticsEmpty').classList.add('hidden');
  document.getElementById('analyticsContent').classList.remove('hidden');

  const { correct, wrong, skipped, numQ, score, totalTime, answers, questions } = session;

  document.getElementById('aScore').textContent    = score + '%';
  document.getElementById('aCorrect').textContent  = correct;
  document.getElementById('aWrong').textContent    = wrong;
  document.getElementById('aSkipped').textContent  = skipped;
  document.getElementById('aTotalTime').textContent = formatTime(totalTime);

  // Doughnut chart
  const dCtx = document.getElementById('doughnutChart').getContext('2d');
  if (state.doughnutChart) state.doughnutChart.destroy();
  state.doughnutChart = new Chart(dCtx, {
    type: 'doughnut',
    data: {
      labels: ['Correct','Wrong','Skipped'],
      datasets: [{
        data: [correct, wrong, skipped],
        backgroundColor: ['#00c9a7','#fc5c7d','#f7b731'],
        borderWidth: 0,
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: '#9098b8', font: { family: 'Inter' } } }
      },
      cutout: '65%',
    }
  });

  // Bar chart — time per question
  const bCtx = document.getElementById('barChart').getContext('2d');
  if (state.barChart) state.barChart.destroy();
  state.barChart = new Chart(bCtx, {
    type: 'bar',
    data: {
      labels: answers.map((_, i) => `Q${i+1}`),
      datasets: [{
        label: 'Seconds',
        data: answers.map(a => a.timeTaken || 0),
        backgroundColor: answers.map(a =>
          a.skipped ? '#f7b731' : a.chosen === a.correct ? '#00c9a7' : '#fc5c7d'
        ),
        borderRadius: 4,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9098b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9098b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });

  renderReviewTable('all', answers, questions);
}

function filterReview(filter, btn) {
  document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (!state.lastSession) return;
  renderReviewTable(filter, state.lastSession.answers, state.lastSession.questions);
}

function renderReviewTable(filter, answers, questions) {
  const wrap = document.getElementById('reviewTable');
  wrap.innerHTML = '';
  answers.forEach((a, i) => {
    const status = a.skipped || !a.chosen ? 'skipped' : a.chosen === a.correct ? 'correct' : 'wrong';
    if (filter !== 'all' && filter !== status) return;

    const q = questions[i] || {};
    const item = document.createElement('div');
    item.className = 'review-item';
    const yourAns = a.chosen ? (a.chosen + ': ' + ((q.options||[]).find(o=>o.letter===a.chosen)||{}).text) : '—';
    const corrAns = a.correct ? (a.correct + ': ' + ((q.options||[]).find(o=>o.letter===a.correct)||{}).text) : '—';
    item.innerHTML = `
      <div class="review-item-header">
        <span class="review-status-badge ${status}">${status.toUpperCase()}</span>
        <span style="font-size:0.8rem;color:var(--text3)">Q${i+1}</span>
      </div>
      <div class="review-q-text">${escHtml((q.question||'').substring(0,200))}</div>
      <div class="review-answers">
        <span>🙋 Your answer: <strong style="color:${status==='correct'?'var(--teal)':'var(--pink)'}">${escHtml(yourAns)}</strong></span>
        <span>✅ Correct: <strong style="color:var(--teal)">${escHtml(corrAns)}</strong></span>
      </div>
      <div class="review-time">⏱ Time taken: ${a.timeTaken}s</div>
    `;
    wrap.appendChild(item);
  });
  if (!wrap.innerHTML) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--text3);padding:24px;font-size:0.9rem">No ${filter} answers.</div>`;
  }
}

/* ================================================================
   RESULTS PDF DOWNLOAD
   ================================================================ */
async function downloadResultsPDF() {
  const session = state.lastSession;
  if (!session) { toast('⚠️ No session data to export.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const pageW = 210, pageH = 297, mg = 15;
  let y = mg;

  // ---- Header ----
  doc.setFillColor(22, 25, 52);
  doc.rect(0, 0, pageW, 40, 'F');
  doc.setTextColor(255,255,255);
  doc.setFont('helvetica','bold');
  doc.setFontSize(22);
  doc.text('InterviewAce — Results Report', mg, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(180,180,200);
  doc.text('Generated: ' + new Date().toLocaleString(), mg, 30);
  doc.text(`Score: ${session.score}%  |  ${session.correct} Correct  |  ${session.wrong} Wrong  |  ${session.skipped} Skipped`, mg, 36);
  y = 50;

  session.answers.forEach((a, idx) => {
    const q = session.questions[idx] || {};
    const status = a.skipped || !a.chosen ? 'skipped' : a.chosen === a.correct ? 'correct' : 'wrong';

    // Check page overflow
    const estimatedH = 18 + (q.options||[]).length * 7 + 10;
    if (y + estimatedH > pageH - mg) {
      doc.addPage();
      y = mg;
    }

    // Question block
    const qLabel = `Q${idx+1}. `;
    const qText  = (q.question || '').substring(0, 220);
    doc.setFont('helvetica','bold');
    doc.setFontSize(10);

    // Status colour
    if (status === 'correct')      doc.setTextColor(0, 180, 150);
    else if (status === 'wrong')   doc.setTextColor(220, 80, 100);
    else                           doc.setTextColor(220, 170, 50);
    doc.text(`[${status.toUpperCase()}]`, mg, y);
    doc.setTextColor(30,30,30);

    const labelW = doc.getTextWidth(`[${status.toUpperCase()}] `);
    doc.text(qLabel + qText, mg + labelW + 2, y, { maxWidth: pageW - mg * 2 - labelW - 2 });

    // Estimate lines used
    const wrappedQ = doc.splitTextToSize(qLabel + qText, pageW - mg * 2 - labelW - 2);
    y += wrappedQ.length * 5 + 3;

    // Options
    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    (q.options || []).forEach(opt => {
      const isCorrect = opt.letter === q.correct;
      const isChosen  = opt.letter === a.chosen;
      if (isCorrect) {
        doc.setTextColor(0, 150, 120);
        doc.setFont('helvetica','bold');
      } else if (isChosen && !isCorrect) {
        doc.setTextColor(200, 60, 80);
        doc.setFont('helvetica','normal');
      } else {
        doc.setTextColor(80, 80, 90);
        doc.setFont('helvetica','normal');
      }
      const marker = isCorrect ? '✓ ' : (isChosen ? '✗ ' : '  ');
      doc.text(`  ${marker}${opt.letter}) ${opt.text}`, mg + 4, y, { maxWidth: pageW - mg * 2 - 4 });
      y += 6;
    });

    // Separator
    doc.setDrawColor(220,220,230);
    doc.line(mg, y + 2, pageW - mg, y + 2);
    y += 8;
  });

  doc.save('InterviewAce_Results.pdf');
  toast('📥 PDF downloaded!');
}

/* ================================================================
   HISTORY
   ================================================================ */
function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  if (state.sessions.length === 0) {
    document.getElementById('historyEmpty').classList.remove('hidden');
    document.getElementById('resultsActionsRow').style.display = 'none';
    return;
  }
  document.getElementById('historyEmpty').classList.add('hidden');
  document.getElementById('resultsActionsRow').style.display = '';

  state.sessions.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const scoreColor = s.score >= 75 ? '#00c9a7' : s.score >= 50 ? '#f7b731' : '#fc5c7d';
    card.innerHTML = `
      <div class="history-score-ring" style="color:${scoreColor};border-color:${scoreColor}">
        ${s.score}%
      </div>
      <div class="history-info">
        <div class="history-date">📅 ${new Date(s.date).toLocaleString()}</div>
        <div class="history-summary">${s.numQ} questions — ✅ ${s.correct} Correct  ❌ ${s.wrong} Wrong  ⏭ ${s.skipped} Skipped</div>
        <div class="history-chips">
          <span class="chip">⏱ ${formatTime(s.totalTime)}</span>
          <span class="chip">~${Math.round(s.totalTime/s.numQ)}s/Q</span>
        </div>
      </div>
      <button class="btn-outline btn-sm" onclick="viewSession(${i})">View</button>
    `;
    list.appendChild(card);
  });
}

function viewSession(idx) {
  state.lastSession = state.sessions[idx];
  navigate('analytics');
}

function clearHistory() {
  if (!confirm('Clear all session history?')) return;
  state.sessions = [];
  state.lastSession = null;
  persistSessions();
  renderHistory();
  toast('🗑️ History cleared.');
}

/* ================================================================
   RECENT SESSIONS (HOME)
   ================================================================ */
function showRecentSessions() {
  if (state.sessions.length === 0) return;
  const card = document.getElementById('recentSessionCard');
  const list = document.getElementById('recentSessionsList');
  card.style.display = '';
  list.innerHTML = '';
  state.sessions.slice(0, 3).forEach((s, i) => {
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)';
    const scoreColor = s.score >= 75 ? '#00c9a7' : s.score >= 50 ? '#f7b731' : '#fc5c7d';
    div.innerHTML = `
      <span style="font-family:Outfit;font-weight:800;font-size:1.2rem;color:${scoreColor};min-width:50px">${s.score}%</span>
      <span style="flex:1;font-size:0.85rem;color:var(--text2)">${new Date(s.date).toLocaleString()}</span>
      <span style="font-size:0.82rem;color:var(--text3)">${s.numQ}Q</span>
    `;
    list.appendChild(div);
  });
}

/* ================================================================
   PERSISTENCE
   ================================================================ */
function persistSessions() {
  try {
    localStorage.setItem('ia_sessions', JSON.stringify(state.sessions.slice(0, 50)));
  } catch(_){}
}

function loadSessions() {
  try {
    const saved = localStorage.getItem('ia_sessions');
    if (saved) state.sessions = JSON.parse(saved);
  } catch(_){}
}

/* ================================================================
   UTILITIES
   ================================================================ */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatTime(secs) {
  if (secs < 60) return secs + 's';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + 'm ' + s + 's';
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  loadSessions();
  syncSettingsUI();

  // Update home stats from saved sessions
  if (state.sessions.length > 0) {
    document.getElementById('statAttempts').textContent = state.sessions.length;
    const best = Math.max(...state.sessions.map(s => s.score));
    document.getElementById('statBestScore').textContent = best + '%';
    const avgT = Math.round(state.sessions.reduce((a,s) => a + s.totalTime / s.numQ, 0) / state.sessions.length);
    document.getElementById('statAvgTime').textContent = avgT + 's';
    state.lastSession = state.sessions[0];
    showRecentSessions();
  }
}

init();
