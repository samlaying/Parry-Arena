(() => {
  const root = document.getElementById("zhen-demo");
  if (!root) return;
  const flow = root.querySelector("#onboardingFlow");
  const next = root.querySelector("#onboardNext");
  const back = root.querySelector("#onboardBack");
  const count = root.querySelector("#onboardCount");
  const bar = root.querySelector("#onboardBar");
  const sceneInput = root.querySelector("#sceneInput");
  const selfInput = root.querySelector("#selfInput");
  const personaInput = root.querySelector("#personaInput");
  if (!flow || !next || !back || !sceneInput || !selfInput || !personaInput) return;

  let step = 1;
  let busy = false;
  let selectedRoleIndex = 0;
  const state = { scene: null, self: null, person: null, sceneText: "", selfText: "", personText: "" };
  window.__zhenOnboardingAI = state;

  function addParseBox(panel, id) {
    if (root.querySelector(`#${id}`)) return;
    const box = document.createElement("div");
    box.id = id;
    box.className = "ai-parse hidden";
    panel.appendChild(box);
  }

  const panels = [...root.querySelectorAll("[data-onboard-step]")].filter((panel) => Number(panel.dataset.onboardStep) !== 3);
  root.querySelector('[data-onboard-step="3"]')?.remove();
  addParseBox(panels[0], "sceneAiParse");
  addParseBox(panels[1], "selfAiParse");
  const personInput = null;

  function renderStep() {
    panels.forEach((panel) => panel.classList.toggle("hidden", Number(panel.dataset.onboardStep) !== step));
    count.textContent = `${step} / 2`;
    bar.style.width = `${step * 50}%`;
    back.classList.toggle("hidden", step === 1);
    next.textContent = step === 2 ? "AI 解析并开始参谋 →" : "AI 解析并继续 →";
    next.disabled = busy;
  }

  function roleText(role) {
    return [role.name, role.relation, role.roleClue, role.power && `权力：${role.power}`, role.persona && `人设：${role.persona}`, role.difficulty && `难点：${role.difficulty}`, role.confidence && `识别状态：${role.confidence}`].filter(Boolean).join("；");
  }

  function selectRole(index) {
    selectedRoleIndex = index;
    const people = state.scene?.detectedPeople || [];
    root.querySelectorAll("[data-role-card]").forEach((card) => card.classList.toggle("selected", Number(card.dataset.roleCard) === index));
    const role = people[index];
    if (role && personInput) personInput.value = role.isKeyPerson && state.scene?.suggestedInput ? state.scene.suggestedInput : [role.power, role.kpReason].filter(Boolean).join("；");
  }

  function renderRoleCards(people) {
    const container = root.querySelector("#roleCards");
    const note = root.querySelector("#peopleDetected");
    if (!container || people.length !== 3) return;
    selectedRoleIndex = Math.max(0, people.findIndex((role) => role.isKeyPerson));
    container.replaceChildren();
    people.forEach((role, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.dataset.roleCard = String(index);
      card.className = `role-card${index === selectedRoleIndex ? " selected" : ""}`;
      const avatar = document.createElement("span");
      avatar.className = "role-avatar";
      avatar.textContent = role.name.replace(/^待确认[·：:]?/, "").slice(0, 1) || String(index + 1);
      const body = document.createElement("div");
      const heading = document.createElement("b");
      heading.textContent = role.name;
      const relation = document.createElement("small");
      relation.textContent = [role.relation, role.confidence].filter(Boolean).join(" · ");
      const clue = document.createElement("p");
      clue.textContent = [role.persona && `人设：${role.persona}`, role.difficulty && `难点：${role.difficulty}`, !role.persona && role.roleClue].filter(Boolean).join("\n");
      body.append(heading, relation, clue);
      const badge = document.createElement("i");
      badge.textContent = role.isKeyPerson ? "关键 KP" : "相关角色";
      card.append(avatar, body, badge);
      card.addEventListener("click", () => selectRole(index));
      container.appendChild(card);
    });
    const kp = people[selectedRoleIndex];
    note.textContent = `主沟通对象：${kp.name} · ${kp.kpReason || "最可能影响本次结果"}`;
    selectRole(selectedRoleIndex);
  }

  function showParse(id, result, error) {
    const box = root.querySelector(`#${id}`);
    if (!box) return;
    box.classList.remove("hidden", "error");
    box.classList.toggle("error", Boolean(error));
    box.replaceChildren();
    const title = document.createElement("b");
    title.textContent = error ? "解析未完成" : "AI 已理解";
    const summary = document.createElement("span");
    summary.textContent = error || result.summary || "资料已结构化";
    box.append(title, summary);
    if (!error && result.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "ai-tags";
      result.tags.forEach((tag) => {
        const item = document.createElement("i");
        item.textContent = tag;
        tags.appendChild(item);
      });
      box.appendChild(tags);
    }
  }

  async function parsePhase(phase, input, context, boxId) {
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase, input, context }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "AI 解析暂时不可用");
    showParse(boxId, payload.result);
    return payload.result;
  }

  function setBusy(value) {
    busy = value;
    next.disabled = value;
    next.textContent = value ? "AI 正在理解…" : step === 2 ? "AI 解析并开始参谋 →" : "AI 解析并继续 →";
  }

  async function advance(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (step === 1) {
        const input = sceneInput.value.trim();
        if (!input) throw new Error("请先说出这次真实的沟通困扰");
        state.sceneText = input;
        state.scene = await parsePhase("scene", input, null, "sceneAiParse");
        step = 2;
        renderStep();
        return;
      }
      if (step === 2) {
        const selectedExample = root.querySelector("[data-role-choice].selected")?.textContent?.trim() || "";
        const raw = selfInput.value.trim();
        const desired = personaInput.value.trim();
        if (!raw && !desired) throw new Error("请先介绍一下自己或想成为的人设");
        const input = [raw, selectedExample && `角色参考：${selectedExample}`, desired && `希望成为：${desired}`].filter(Boolean).join("\n");
        state.selfText = input;
        state.self = await parsePhase("self", input, { scene: state.scene }, "selfAiParse");
        const selectedRole = (state.self.detectedPeople || []).find((role) => role.isKeyPerson) || state.self.detectedPeople?.[0];
        if (!selectedRole) throw new Error("AI 未能识别本次最关键的沟通对象，请补充对方是谁或谁能拍板。");
        state.personText = roleText(selectedRole);
        state.person = { summary: [selectedRole.persona, selectedRole.difficulty].filter(Boolean).join("；"), profile: { name: selectedRole.name, relationship: selectedRole.relation, power: selectedRole.power, communicationStyle: selectedRole.persona, difficulty: selectedRole.difficulty, evidence: selectedRole.roleClue } };
      const personLabel = [selectedRole.name, selectedRole.relation].filter(Boolean).join(" · ") || state.personText;
      flow.classList.add("hidden");
      flow.style.display = "none";
      root.querySelector('[data-page="advisor"]')?.click();
      const personNode = root.querySelector("#advisorPersonText");
      const problemNode = root.querySelector("#advisorProblemText");
      if (personNode) personNode.textContent = personLabel;
      if (problemNode) problemNode.textContent = state.self?.profile?.painPoint || state.scene?.profile?.coreConflict || state.sceneText;
      root.querySelector("#title").textContent = "职场参谋";
      if (typeof window.zhenAnalyzeAndRender === "function") window.zhenAnalyzeAndRender(state.sceneText, personLabel, "徐阶", "");
        return;
      }
    } catch (error) {
      const boxId = step === 1 ? "sceneAiParse" : "selfAiParse";
      showParse(boxId, {}, error instanceof Error ? error.message : "AI 解析暂时不可用");
    } finally {
      setBusy(false);
    }
  }

  function goBack(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!busy && step > 1) {
      step -= 1;
      renderStep();
    }
  }

  function startVoice(input, status) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      status.textContent = "当前浏览器不支持语音识别，请直接打字补充。";
      input.focus();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    status.textContent = "正在听，请开始说…";
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      input.value = [input.value.trim(), transcript].filter(Boolean).join(" ");
      status.textContent = "语音已转成文字，可继续编辑后提交 AI 解析。";
    };
    recognition.onerror = () => { status.textContent = "没有识别成功，可以重试或直接打字。"; };
    recognition.start();
  }
  window.zhenStartVoiceInput = startVoice;

  root.querySelectorAll("[data-voice-fill]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const type = button.dataset.voiceFill;
    const input = type === "scene" ? sceneInput : type === "role" ? selfInput : personInput;
    const status = root.querySelector(type === "scene" ? "#sceneVoiceText" : type === "role" ? "#roleVoiceText" : "#peopleVoiceText");
    if (input && status) startVoice(input, status);
  }, true));

  next.addEventListener("click", advance, true);
  back.addEventListener("click", goBack, true);
  root.querySelector("#enterProduct")?.addEventListener("click", () => { step = 1; renderStep(); });
  const style = document.createElement("style");
  style.textContent = '.ai-parse{display:grid;gap:4px;margin-top:10px;padding:10px 11px;border:1px solid #b7d0d8;border-radius:12px;background:#edf5f6;color:#294c5d;font-size:10px;line-height:1.5}.ai-parse.hidden{display:none}.ai-parse.error{border-color:#dfb3ab;background:#fff0ed;color:#91493f}.ai-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}.ai-tags i{font-style:normal;padding:3px 6px;border-radius:8px;background:#dcebed}.onboard-actions button:disabled{opacity:.55;cursor:wait}.role-cards{display:grid;gap:7px;margin:9px 0 12px}.role-skeleton{padding:14px;border:1px dashed #b8cbd5;border-radius:13px;color:#71858f;text-align:center}.role-card{position:relative;display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:9px;width:100%;padding:9px;border:1px solid #cbd8e1;border-radius:14px;background:#fff;color:#173747;text-align:left}.role-card.selected{border:2px solid #123f4d;background:#eef5f6}.role-avatar{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:#1b5c72;color:#fff;font-weight:900}.role-card b,.role-card small{display:block}.role-card small{margin-top:1px;color:#6d7f89;font-size:9px}.role-card p{white-space:pre-line;margin:3px 0 0;font-size:10px;line-height:1.42}.role-card i{align-self:start;padding:3px 5px;border-radius:7px;background:#e7eef2;color:#5b6d76;font-size:8px;font-style:normal}.role-card.selected i{background:#123f4d;color:#fff}#personInput{width:100%;resize:none;border:1px solid #cbd8e1;border-radius:14px;background:#fff;color:#173747;padding:11px;font:inherit;line-height:1.55}.start-advisor-direct{width:100%;margin-top:11px;border:0;border-radius:14px;padding:12px;font:inherit;font-size:12px;font-weight:900}';
  document.head.appendChild(style);
  renderStep();
})();
