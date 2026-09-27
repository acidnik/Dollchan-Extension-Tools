/* ==[ Form.js ]==============================================================================================
                                                   POSTFORM
                 postform improving, quick reply window, markup text panel, sage button, etc
=========================================================================================================== */

class PostForm {
	constructor(form, oeForm = null, ignoreForm = false) {
		this.isBottom = false;
		this.isHidden = false;
		this.isQuick = false;
		this.lastQuickPNum = -1;
		this.pArea = [];
		this.pForm = null;
		this.qArea = null;
		this.quotedText = '';
		this._pBtn = [];
		const qOeForm = 'form[name="oeform"], form[action*="paint"]';
		this.oeForm = oeForm || $q(qOeForm);
		if(!ignoreForm && !form) {
			if(this.oeForm) {
				ajaxLoad(aib.getThrUrl(aib.b, Thread.first.num), false).then(loadedDoc => {
					const form = $q(aib.qForm, loadedDoc);
					const oeForm = $q(qOeForm, loadedDoc);
					postform = new PostForm(form && doc.adoptNode(form),
						oeForm && doc.adoptNode(oeForm), true);
				}, () => (postform = new PostForm(null, null, true)));
			} else {
				this.form = null;
			}
			return;
		}
		this.tNum = aib.t;
		this.form = form;
		this.files = null;
		this.txta = $q(aib.qFormTxta, form);
		this.subm = $q(aib.qFormSubm, form);
		this.name = $q(aib.qFormName, form);
		this.mail = $q(aib.qFormMail, form);
		this.subj = $q(aib.qFormSubj, form);
		this.passw = $q(aib.qFormPassw, form);
		this.rules = $q(aib.qFormRules, form);
		this.video = $q('tr input[name="video"], tr input[name="embed"]', form);
		this._initFileInputs();
		this._makeHideableContainer();
		this._makeWindow();
		if(!form || !this.txta) {
			return;
		}
		form.style.display = 'inline-block';
		form.style.textAlign = 'left';
		const { qArea, txta } = this;
		new WinResizer('reply', 'top', 'textaHeight', qArea, txta);
		new WinResizer('reply', 'left', 'textaWidth', qArea, txta);
		new WinResizer('reply', 'right', 'textaWidth', qArea, txta);
		new WinResizer('reply', 'bottom', 'textaHeight', qArea, txta);
		this._initTextarea();
		this.addMarkupPanel();
		this.setPlaceholders();
		this._initCaptcha();
		// Browsers read a captcha or a nickname field sitting next to a filled password as a login form, and
		// Firefox then offers its password manager on the captcha. A plain opt-out is ignored there, so the
		// fields state what they are and leave nothing for the browser to guess.
		if(this.form) {
			this.form.autocomplete = 'off';
		}
		if(this.passw) {
			this.passw.autocomplete = 'off';
		}
		if(this.name) {
			this.name.autocomplete = 'nickname';
		}
		if(this.mail) {
			this.mail.autocomplete = 'email';
		}
		this._initSubmit();
		aib.updateSubmitBtn(this.subm);
		if(Cfg.ajaxPosting) {
			this._initAjaxPosting();
		}
		if(Cfg.altLayout) {
			this._applyAltLayout();
		}
		if(Cfg.addSageBtn && this.mail) {
			PostForm.hideField(this.mail.closest('label') || this.mail);
			setTimeout(() => this.toggleSage(), 0);
		}
		if(Cfg.noPassword && this.passw) {
			$hide(PostForm.getFieldWrap(this.passw));
		}
		if(Cfg.noName && this.name) {
			PostForm.hideField(this.name);
		}
		if(Cfg.noSubj && this.subj) {
			PostForm.hideField(this.subj);
		}
		if(Cfg.userName && this.name) {
			setTimeout(PostForm.setUserName, 0);
		}
		if(this.passw) {
			setTimeout(PostForm.setUserPassw, 0);
		}
	}
	// The element wrapping a single form field: the board's own row, or the cell of the alternative layout.
	// The app hides and finds fields per wrapper (hideField, files.fileTr, captcha.parentEl), and in the
	// alternative layout a form row can hold several fields, so the nearest wrapper is what those need.
	static getFieldWrap(el) {
		return el.closest(`${ aib.qFormTr }, .de-altcell`);
	}
	static hideField(el) {
		const els = el.parentNode.children;
		let hideTr = true;
		for(let i = 0, len = els.length; i < len; ++i) {
			if(els[i] !== el && els[i].style.display !== 'none') {
				hideTr = false;
				break;
			}
		}
		$toggle(hideTr ? PostForm.getFieldWrap(el) : el);
	}
	static async setUserName() {
		const el = $q('input[info="nameValue"]');
		if(el) {
			await CfgSaver.save('nameValue', el.value);
		}
		postform.name.value = Cfg.userName ? Cfg.nameValue : '';
	}
	static async setUserPassw() {
		if(!Cfg.userPassw) {
			return;
		}
		const el = $q('input[info="passwValue"]');
		if(el) {
			await CfgSaver.save('passwValue', el.value);
		}
		const value = postform.passw.value = Cfg.passwValue;
		for(const { passEl } of DelForm) {
			if(passEl) {
				passEl.value = value;
			}
		}
	}
	get isVisible() {
		if(!this.isHidden && this.isBottom && $q(':focus', this.pForm)) {
			const cr = this.pForm.getBoundingClientRect();
			return cr.bottom > 0 && cr.top < nav.viewportHeight();
		}
		return false;
	}
	get sageBtn() {
		const value = $aEnd(this.subm, '<span id="de-sagebtn"><svg class="de-btn-sage">' +
			'<use xlink:href="#de-symbol-post-sage"/></svg></span>');
		value.onclick = async () => {
			await toggleCfg('sageReply');
			this.toggleSage();
		};
		Object.defineProperty(this, 'sageBtn', { value });
		return value;
	}
	get top() {
		return this.pForm.getBoundingClientRect().top;
	}
	addMarkupPanel() {
		if(aib.noMarkupBtns) {
			return;
		}
		let el = $id('de-txt-panel');
		if(!Cfg.addTextBtns) {
			el?.remove();
			return;
		}
		if(!el) {
			el = nav.parseHTML('<span id="de-txt-panel"></span>');
			['click', 'mouseover'].forEach(e => el.addEventListener(e, this));
		}
		el.style.cssFloat = Cfg.txtBtnsLoc ? 'none' : 'right';
		(Cfg.txtBtnsLoc ? $id('de-resizer-text') || this.txta : this.subm).after(el);
		const id = ['bold', 'italic', 'under', 'strike', 'spoil', 'code', 'sup', 'sub'];
		const val = ['B', 'i', 'U', 'S', '%', 'C', 'x\u00b2', 'x\u2082'];
		const mode = Cfg.addTextBtns;
		let html = '';
		for(let i = 0, len = aib.markupTags.length; i < len; ++i) {
			const tag = aib.markupTags[i];
			if(tag) {
				html += `<div id="de-btn-${ id[i] }" de-title="${ Lng.txtBtn[i][lang] }" de-tag="${ tag }">${
					mode === 2 ? `${ !html ? '[' : '' }&nbsp;<a class="de-abtn" href="#">${ val[i] }</a> /` :
					mode === 3 ? `<button type="button" style="font-weight: bold;">${ val[i] }</button>` :
					`<svg><use xlink:href="#de-symbol-markup-${ id[i] }"/></svg>`
				}</div>`;
			}
		}
		el.innerHTML = `${ html }<div id="de-btn-quote" de-title="${ Lng.txtBtn[8][lang] }" de-tag="q">${
			mode === 2 ? '&nbsp;<a class="de-abtn" href="#">&gt;</a> ]' :
			mode === 3 ? '<button type="button" style="font-weight: bold;">&gt;</button>' :
			'<svg><use xlink:href="#de-symbol-markup-quote"/></svg>'
		}</span>`;
	}
	clearForm() {
		if(this.txta) {
			this.txta.value = '';
		}
		if(this.files) {
			this.files.clearInputs();
		}
		if(this.video) {
			this.video.value = '';
		}
	}
	closeReply() {
		if(this.isQuick) {
			this.isQuick = false;
			this.lastQuickPNum = -1;
			if(!aib.t) {
				this._toggleQuickReply(false);
				this.tNum = false;
			}
			this.setReply(false, !aib.t || Cfg.addPostForm > 1);
		}
	}
	getSelectedText() {
		this.quotedText = deWindow.getSelection().toString();
	}
	handleEvent(e) {
		let el = e.target;
		if(el.tagName.toLowerCase() !== 'div') {
			el = el.parentNode;
		}
		const { id } = el;
		if(!id.startsWith('de-btn')) {
			return;
		}
		if(e.type === 'mouseover') {
			if(id === 'de-btn-quote') {
				this.getSelectedText();
			}
			let key = -1;
			if(HotKeys.enabled) {
				switch(id.substr(7)) {
				case 'bold': key = 12; break;
				case 'italic': key = 13; break;
				case 'strike': key = 14; break;
				case 'spoil': key = 15; break;
				case 'code': key = 16;
				}
			}
			KeyEditListener.setTitle(el, key);
			return;
		}
		const txtaEl = postform.txta;
		const { selectionStart: start, selectionEnd: end } = txtaEl;
		const quote = Cfg.spacedQuote ? '> ' : '>';
		if(id === 'de-btn-quote') {
			insertText(txtaEl, quote + (start === end ? this.quotedText : txtaEl.value.substring(start, end))
				.replace(/^[\r\n]|[\r\n]+$/g, '')
				.replace(/\n/gm, '\n' + quote) + (this.quotedText ? '\n' : ''));
			this.quotedText = '';
		} else {
			const { scrtop, value } = txtaEl;
			const val = PostForm._wrapText(el.getAttribute('de-tag'), value.substring(start, end));
			const len = start + val[0];
			txtaEl.value = value.substr(0, start) + val[1] + value.substr(end);
			txtaEl.setSelectionRange(len, len);
			txtaEl.focus();
			txtaEl.scrollTop = scrtop;
		}
		e.preventDefault();
		e.stopPropagation();
	}
	refreshCaptchaTNum(isError = false) {
		this.captcha?.refreshCaptcha(isError, isError, this.tNum);
	}
	setPlaceholders() {
		if(aib.formHeaders || !aib.multiFile && Cfg.fileInputs === 2) {
			return;
		}
		this._setPlaceholder('name');
		this._setPlaceholder('subj');
		this._setPlaceholder('mail');
		this._setPlaceholder('video');
		if(this.captcha) {
			this._setPlaceholder('captcha');
		}
	}
	setReply(isQuick, needToHide) {
		if(isQuick) {
			this.qArea.firstChild.after(this.pForm);
		} else {
			this.pArea[+this.isBottom].after(this.qArea);
			this._pBtn[+this.isBottom].after(this.pForm);
		}
		this.isHidden = needToHide;
		$toggle(this.qArea, isQuick);
		$toggle(this.pForm, !needToHide);
		this.updatePAreaBtns();
	}
	showMainReply(isBottom, e) {
		this.closeReply();
		if(!aib.t) {
			this.tNum = false;
			this.refreshCaptchaTNum();
		}
		if(this.isBottom === isBottom) {
			$toggle(this.pForm, this.isHidden);
			this.isHidden = !this.isHidden;
			this.updatePAreaBtns();
		} else {
			this.isBottom = isBottom;
			this.setReply(false, false);
		}
		if(e) {
			e.preventDefault();
		}
	}
	showQuickReply(post, pNum, isCloseReply, isNumClick, isNoLink = false) {
		if(!this.isQuick) {
			this.isQuick = true;
			this.setReply(true, false);
			$q('a', this._pBtn[+this.isBottom]).className =
				`link-button de-parea-btn-${ aib.t ? 'reply' : 'thr' }`;
		} else if(isCloseReply && !this.quotedText && post.wrap.nextElementSibling === this.qArea) {
			this.closeReply();
			return;
		}
		post.wrap.after(this.qArea);
		if(this.qArea.classList.contains('de-win')) {
			updateWinZ(this.qArea);
		}
		const qNum = post.thr.num;
		if(!aib.t) {
			this._toggleQuickReply(qNum);
		}
		if(!this.form) {
			return;
		}
		if(!aib.t && this.tNum !== qNum) {
			this.tNum = qNum;
			this.refreshCaptchaTNum();
		}
		this.tNum = qNum;
		const txt = this.txta.value;
		const isOnNewLine = txt === '' || txt.slice(-1) === '\n';
		const link = isNoLink || post.isOp && !Cfg.addOPLink && !aib.t && !isNumClick ? '' :
			isNumClick ? `>>${ pNum }${ isOnNewLine ? '\n' : '' }` :
			(isOnNewLine ? '' : '\n') +
				(this.lastQuickPNum === pNum && txt.includes('>>' + pNum) ? '' : `>>${ pNum }\n`);
		const quote = this.quotedText ? `${ this.quotedText.replace(/^[\r\n]|[\r\n]+$/g, '')
			.replace(/(^|\n)(.)/gm, `$1>${ Cfg.spacedQuote ? ' ' : '' }$2`) }\n` : '';
		insertText(this.txta, link + quote);
		const winTitle = post.thr.op.title.trim();
		$q('.de-win-title', this.qArea).textContent =
			(winTitle.length < 28 ? winTitle : `${ winTitle.substr(0, 30) }\u2026`) || `#${ pNum }`;
		this.lastQuickPNum = pNum;
	}
	toggleSage() {
		if(!Cfg.addSageBtn || !this.mail) {
			return;
		}
		const isSage = Cfg.sageReply;
		this.sageBtn.style.opacity = isSage ? '1' : '.3';
		this.sageBtn.title = isSage ? Lng.disableSage[lang] : Lng.enableSage[lang];
		if(this.mail.type === 'text') {
			this.mail.value = isSage ? 'sage' : aib._4chan ? 'noko' : '';
		} else {
			this.mail.checked = isSage;
		}
	}
	updatePAreaBtns() {
		const txt = 'link-button de-parea-btn-';
		const rep = aib.t ? 'reply' : 'thr';
		$q('a', this._pBtn[+this.isBottom]).className = txt + (!this.pForm.style.display ? 'close' : rep);
		$q('a', this._pBtn[+!this.isBottom]).className = txt + rep;
	}

	static _wrapText(tag, text) {
		let isBB = aib.markupBB;
		if(tag.startsWith('[')) {
			tag = tag.substr(1);
			isBB = true;
		}
		if(isBB) {
			if(text.includes('\n')) {
				const str = `[${ tag }]${ text }[/${ tag }]`;
				return [str.length, str];
			}
			const m = text.match(/^(\s*)(.*?)(\s*)$/);
			const str = `${ m[1] }[${ tag }]${ m[2] }[/${ tag }]${ m[3] }`;
			return [!m[2].length ? m[1].length + tag.length + 2 : str.length, str];
		}
		let m;
		let rv = '';
		let i = 0;
		const arr = text.split('\n');
		for(let len = arr.length; i < len; ++i) {
			m = arr[i].match(/^(\s*)(.*?)(\s*)$/);
			rv += '\n' + m[1] + (tag === '^H' ? m[2] + '^H'.repeat(m[2].length) : tag + m[2] + tag) + m[3];
		}
		return [i === 1 && !m[2].length && tag !== '^H' ?
			m[1].length + tag.length :
			rv.length - 1, rv.slice(1)];
	}
	_initAjaxPosting() {
		let el;
		if(aib.qFormRedir && (el = $q(aib.qFormRedir, this.form))) {
			$hide(el.closest(aib.qFormTr));
			el.checked = true;
		}
		this.form.onsubmit = async e => {
			e.preventDefault();
			$popup('upload', Lng.sending[lang], true);
			try {
				const data = await html5Submit(this.form, this.subm, true);
				await checkSubmit(data);
			} catch(err) {
				showSubmitError(err);
			}
		};
	}
	_initCaptcha() {
		const capEl = aib.getCaptchaEl(this.form);
		if(!capEl) {
			this.captcha = null;
			return;
		}
		this.captcha = new Captcha(capEl, this.tNum);
		const updCaptchaFn = () => {
			this.captcha.addCaptcha();
			this.captcha.updateOutdated();
		};
		this.txta.addEventListener('focus', updCaptchaFn);
		if(this.files) {
			this.files.onchange = updCaptchaFn;
		}
		this.form.addEventListener('click', () => this.captcha.addCaptcha(), true);
	}
	_initFileInputs() {
		const fileEl = $q(aib.qFormFile, this.form);
		if(!fileEl) {
			return;
		}
		aib.fixFileInputs?.(fileEl.closest(aib.qFormTd));
		this.files = new Files(this, $q(aib.qFormFile, this.form));
		// We need to clear file inputs in case if session was restored.
		deWindow.addEventListener('load',
			() => setTimeout(() => !this.files.filesCount && this.files.clearInputs(), 0));
	}
	_initSubmit() {
		this.subm.addEventListener('click', e => {
			if(Cfg.warnSubjTrip && this.subj && /#.|##./.test(this.subj.value)) {
				e.preventDefault();
				$popup('upload', Lng.subjHasTrip[lang]);
				return;
			}
			let val = this.txta.value;
			if(Spells.outreps) {
				val = Spells.outReplace(val);
			}
			if(this.tNum && pByNum.get(this.tNum).subj === 'Dollchan Extension Tools') {
				const temp = `\n\n${ PostForm._wrapText(aib.markupTags[5],
					`${ '-'.repeat(50) }\n${ nav.userAgent }\nv${ version }.${ commit }${
						nav.isESNext ? '.es6' : '' } [${ nav.scriptHandler }]`
				)[1] }`;
				if(!val.includes(temp)) {
					val += temp;
				}
			}
			this.txta.value = val;
			this.toggleSage();
			if(Cfg.ajaxPosting) {
				$popup('upload', Lng.checking[lang], true);
			}
			if(this.video && (val = this.video.value?.match(Videos.ytReg))) {
				this.video.value = 'http://www.youtube.com/watch?v=' + val[1];
			}
			if(this.isQuick) {
				$hide(this.pForm);
				$hide(this.qArea);
				this._pBtn[+this.isBottom].after(this.pForm);
			}
			updater.pauseUpdater();
		});
	}
	_initTextarea() {
		const el = this.txta;
		el.classList.add('de-textarea');
		const { style } = el;
		style.setProperty('width', Cfg.textaWidth + 'px', 'important');
		style.setProperty('height', Cfg.textaHeight + 'px', 'important');
		// Allow to scroll page on PgUp/PgDn
		el.addEventListener('keypress', e => {
			const code = e.charCode || e.keyCode;
			if((code === 33 /* PgUp */ || code === 34 /* PgDn */) && e.which === 0) {
				e.target.blur();
				deWindow.focus();
			}
		});
		// Add files from clipboard to file inputs on Ctrl+V
		el.addEventListener('paste', async e => {
			const files = e?.clipboardData?.files;
			if(!files?.length || !this.files) {
				return;
			}
			const inputs = this.files._inputs;
			const inputFiles = this.files._files;
			for(const file of files) {
				for(let i = 0, len = inputs.length; i < len; ++i) {
					const input = inputs[i];
					if(!input.hasFile) {
						// Read the file directly. Reloading it through a blob: URL is not possible
						// on boards whose CSP does not allow blob: connections (e.g. endchan.org).
						inputFiles[i] = file;
						await FileInput._readDroppedFile(input, file);
						DollchanAPI.notify('filechange', inputFiles);
						break;
					}
				}
			}
		});
		// Saving the textarea size when resizing.
		if(nav.isFirefox || nav.isWebkit) {
			el.addEventListener('mouseup', ({ target }) => {
				const s = target.style;
				const { width, height } = s;
				s.setProperty('width', width + 'px', 'important');
				s.setProperty('height', height + 'px', 'important');
				/* await */ CfgSaver.save('textaWidth', parseInt(width, 10),
					'textaHeight', parseInt(height, 10));
			});
			return;
		}
		// Creating a resizer in browsers that don't have one.
		$aEnd(el, '<div id="de-resizer-text"></div>').addEventListener('mousedown', {
			_el     : el,
			_elStyle: style,
			handleEvent(e) {
				switch(e.type) {
				case 'mousedown':
					['mousemove', 'mouseup'].forEach(e => doc.body.addEventListener(e, this));
					e.preventDefault();
					return;
				case 'mousemove': {
					const cr = this._el.getBoundingClientRect();
					this._elStyle.setProperty('width', (e.clientX - cr.left) + 'px', 'important');
					this._elStyle.setProperty('height', (e.clientY - cr.top) + 'px', 'important');
					return;
				}
				default: // mouseup
					['mousemove', 'mouseup'].forEach(e => doc.body.removeEventListener(e, this));
					/* await */ CfgSaver.save('textaWidth', parseInt(this._elStyle.width, 10),
						'textaHeight', parseInt(this._elStyle.height, 10));
				}
			}
		});
	}
	_makeHideableContainer() {
		(this.pForm = nav.parseHTML('<div id="de-pform" class="de-win-body"></div>'))
			.append(this.form || '', this.oeForm || '');
		const html = '<div class="de-parea"><div><a href="#"></a></div><hr></div>';
		// The bottom area belongs right after the posts: a board can keep its own block at the end of the
		// delform, and the reply form would end up below it (endchan: navigation, layout/colour selects,
		// delete and report buttons)
		const bottomEl = aib.qBottomAnchor && $q(aib.qBottomAnchor, DelForm.first.el);
		this.pArea = [$bBegin(DelForm.first.el, html),
			bottomEl ? $bBegin(bottomEl, html) : $aEnd(DelForm.first.el, html)];
		this._pBtn = [this.pArea[0].firstChild, this.pArea[1].firstChild];
		this._pBtn[0].firstElementChild.onclick = e => this.showMainReply(false, e);
		this._pBtn[1].firstElementChild.onclick = e => this.showMainReply(true, e);
		this.qArea = nav.parseHTML(`<div style="display: none; ${ Cfg.replyWinX }; ${
			Cfg.replyWinY }; z-index: ${ ++topWinZ };" id="de-win-reply" class="${
			aib.cReply + (Cfg.replyWinDrag ? ' de-win' : ' de-win-inpost') }"></div>`);
		this.isBottom = Cfg.addPostForm === 1;
		this.setReply(false, !aib.t || Cfg.addPostForm > 1);
	}
	// The board can bring its own help link (endchan: "help" → /.static/posting.html), otherwise the URL from
	// the board settings is used; if neither exists the link is not drawn at all
	_getFormHelpEl() {
		const native = $q('a[href*=".static"]', this.form);
		if(native) {
			native.className = 'de-altform-help';
		} else if(aib.formHelpUrl) {
			const el = doc.createElement('a');
			el.className = 'de-altform-help';
			el.href = aib.getAbsLink(aib.formHelpUrl);
			this.form.append(el);
		} else {
			return null;
		}
		const el = $q('.de-altform-help', this.form);
		el.textContent = '?';
		el.target = '_blank';
		el.title = Lng.formHelp[lang];
		return el;
	}
	// Cfg.altLayout: the reply form in this fork's row order. Every group of fields gets its own cell, the
	// board's markup is moved into it, and the pieces the app caches by reference (files.fileTr,
	// captcha.parentEl) are pointed at those cells, so their own logic keeps working on the rebuilt form.
	_applyAltLayout() {
		const { form, txta, subm, name, subj, mail, passw, video, files, captcha } = this;
		// The quick reply box is the board's own element, and endchan pins it to fit-content with
		// !important; our marker class outranks that rule, so the form keeps its width under a post too.
		this.qArea.classList.add('de-altreply');
		const isTable = !!txta.closest('tr');
		const mk = (tag, cls) => {
			const el = doc.createElement(tag);
			el.className = cls;
			return el;
		};
		const cell = (...els) => {
			const el = mk(isTable ? 'td' : 'div', 'de-altcell');
			el.append(...els.filter(Boolean));
			return el;
		};
		// A field travels with the wrapper carrying its own text, as long as that wrapper holds no other
			// control: endchan keeps the spoiler checkbox in <label> Spoiler </label>, and moving the input
			// alone left it nameless. Table cells are not moved, only their content is.
		const groupOf = el => {
			if(!el) {
				return null;
			}
			const isSingle = node => node.querySelectorAll('input, select, textarea, button').length === 1;
			const label = el.closest('label');
			if(label && isSingle(label)) {
				return label;
			}
			const { parentNode: parent } = el;
			const isCell = parent && (parent.tagName === 'TD' || parent.tagName === 'TH');
			if(parent && parent !== form && !isCell && isSingle(parent)) {
				return parent;
			}
			return el;
		};
		const row = (...cells) => {
			const keep = cells.filter(el => el?.childElementCount);
			if(!keep.length) {
				return null;
			}
			const el = mk(isTable ? 'tr' : 'div', 'de-altrow');
			el.append(...keep);
			return el;
		};
		// A wrapper per file input: the app hides a single empty input through it, and one shared cell would
		// hide the whole block with its thumbnails instead
		let fileCell = null;
		if(files) {
			fileCell = cell();
			const txtArea = FileInput._isThumbMode && $q('.de-file-txt-area', form);
			fileCell.append(...[txtArea, files.thumbsEl].filter(Boolean));
			for(const inp of files._inputs) {
				const holder = mk('div', 'de-altfile');
				const parts = FileInput._isThumbMode ?
					[inp._input] :
					[inp._txtWrap, inp._input, inp._utils];
				holder.append(...parts);
				fileCell.append(holder);
			}
			files.fileTr = fileCell;
		}
		// The captcha object owns its wrapper, so it gets the new cell and its content moves there. That
		// content is usually empty at this point: Dollchan empties the wrapper and puts the captcha back on
		// focus, and a board can add its own after a failed post — so the cell stays even while empty, or
		// the captcha would be restored into a cell that is not in the document
		let capCell = null;
		if(captcha?.parentEl) {
			capCell = cell(...[...captcha.parentEl.childNodes]);
			captcha.parentEl = capCell;
		}
		const capRow = capCell ? mk(isTable ? 'tr' : 'div', 'de-altrow') : null;
		if(capRow) {
			// The board stacks the captcha: image, hint, then the input with its reload button — the cell has
			// to keep that flow instead of putting everything on one line
			capCell.classList.add('de-altcell-cap');
			capRow.append(capCell);
		}
		const markup = $id('de-txt-panel');
		if(markup) {
			markup.style.cssFloat = 'none';
		}
		const spoiler = aib.qFormSpoiler && $q(aib.qFormSpoiler, form);
		const flag = $q('select[name="flag"]', form);
		const drawing = [...form.querySelectorAll('#oekakiWidth, #oekakiHeight')];
		// The board's own link that sizes and opens its canvas, and the container it draws into
		const drawLink = $q('a[onclick*="Draw("]', form);
		const wPaint = $id('wPaint');
		// The file limits belong under the file block, and the board's own links — rules, management and
		// navigation — under the answer button. endchan marks its management links with .small too, so the
		// limits are the .small bits that are not links.
		const ownSmalls = [...form.querySelectorAll(':scope > .small')];
		const fileHints = ownSmalls.filter(el => !el.matches('a') && !el.querySelector('a'));
		const boardEls = new Set([...form.querySelectorAll(':scope > p')]
			.filter(el => !fileHints.includes(el) && el.style.display !== 'none'));
		for(const el of ownSmalls) {
			if(el.matches('a') || el.querySelector('a')) {
				const para = el.closest('p') || el;
				if(para.style.display !== 'none') {
					boardEls.add(para);
				}
			}
		}
		if(fileHints.length) {
			const hintWrap = mk('div', 'de-altcell-hints');
			hintWrap.append(...fileHints);
			if(fileCell) {
				fileCell.append(hintWrap);
			} else {
				fileCell = cell(hintWrap);
			}
		}
		// The drawing block: the size fields, the board's own wording as a hint, and its link turned into the
		// button that opens the canvas
		if(drawLink) {
			const hint = drawLink.textContent.trim();
			// The board's link is href="#" plus its own Draw(): a click scrolls the page to the top, and the
			// canvas can never be closed. Ours toggles instead and lets the board size its canvas.
			const boardDraw = drawLink.onclick;
			drawLink.className = 'de-altform-open';
			drawLink.textContent = Lng.openCanvas[lang];
			drawLink.onclick = null;
			if(hint) {
				const hintEl = mk('span', 'de-altform-hint');
				hintEl.textContent = hint;
				drawing.push(hintEl);
			}
			if(wPaint) {
				$hide(wPaint);
				let isOpen = false;
				drawLink.addEventListener('click', e => {
					e.preventDefault();
					if(isOpen) {
						$hide(wPaint);
					} else {
						// Shown first: the board's plugin builds its canvas on a visible element
						$show(wPaint);
						if(!$q('canvas', wPaint)) {
							boardDraw?.call(drawLink);
						}
					}
					isOpen = !isOpen;
				});
			}
		}
		const sageBtn = Cfg.addSageBtn && mail ? this.sageBtn : null;
		// A zero-height full-width flex item breaks the line: the canvas opens under the controls, and its
		// container keeps the width the board gave it (otherwise the canvas stretches to the row)
		const drawBreak = wPaint ? mk('div', 'de-altbreak') : null;
		// The reply textarea spans the form: it is the widest thing in it, and a width taken from the caption
		// block or from a fixed setting looks wrong next to a rebuilt layout
		// The form itself gets the width: the board's form is an inline-block, so it shrinks to its content
		// and a percentage on the table inside it would resolve against nothing
		form.classList.add('de-altform-form');
		const txtaCell = cell(txta);
		txtaCell.classList.add('de-altcell-wide');
		txta.style.setProperty('width', '100%', 'important');
		// The answer button is the point of the form, so it gets its own look and a larger font
		subm.classList.add('de-altform-submit');
		// The board's links keep their own line breaks: it is a stack of paragraphs, not one long line, and
		// joining them is what stretched the whole form
		const linkCell = cell(...boardEls);
		linkCell.classList.add('de-altcell-links');
		const rows = [
			row(cell(name), cell(subj), cell(sageBtn || mail)),
			row(cell(groupOf(spoiler)), cell(groupOf(flag))),
			row(fileCell, cell(video)),
			row(cell(markup, this._getFormHelpEl())),
			row(txtaCell),
			capRow,
			row(cell(subm), cell(passw)),
			row(linkCell),
			row(cell(...drawing, drawLink, drawBreak, wPaint))
		].filter(Boolean);
		const layout = mk(isTable ? 'table' : 'div', 'de-altform');
		layout.append(...rows);
		form.prepend(layout);
		// The board's own layout stays in place but is hidden: it still carries the hidden fields and the
		// board's own fallback submit button, and display:none does not stop them from being submitted
		for(const el of [...form.children]) {
			if(el !== layout) {
				$hide(el);
			}
		}
	}
	_makeWindow() {
		makeDraggable('reply', this.qArea, $aBegin(this.qArea, `<div class="de-win-head">
			<span class="de-win-title"></span>
			<span class="de-win-buttons">
				<svg class="de-win-btn-clear"><use xlink:href="#de-symbol-unavail"/></svg>
				<svg class="de-win-btn-toggle"><use xlink:href="#de-symbol-win-arrow"/></svg>
				<svg class="de-win-btn-close"><use xlink:href="#de-symbol-win-close"/></svg>
			</span>
		</div>
		<div class="de-resizer de-resizer-top"></div>
		<div class="de-resizer de-resizer-left"></div>
		<div class="de-resizer de-resizer-right"></div>
		<div class="de-resizer de-resizer-bottom"></div>`));
		const buttons = $q('.de-win-buttons', this.qArea);
		buttons.onmouseover = ({ target }) => {
			const el = target.parentNode;
			switch(target.classList[0]) {
			case 'de-win-btn-clear': el.title = Lng.clearForm[lang]; break;
			case 'de-win-btn-close': el.title = Lng.closeReply[lang]; break;
			case 'de-win-btn-toggle': el.title = Cfg.replyWinDrag ? Lng.underPost[lang] : Lng.makeDrag[lang];
			}
		};
		const [clearBtn, toggleBtn, closeBtn] = [...buttons.children];
		clearBtn.onclick = async () => {
			await CfgSaver.save('sageReply', 0);
			this.toggleSage();
			this.files.clearInputs();
			[this.txta, this.name, this.mail, this.subj, this.video, this.captcha && this.captcha.textEl]
				.forEach(el => el && (el.value = ''));
		};
		toggleBtn.onclick = async () => {
			await toggleCfg('replyWinDrag');
			if(Cfg.replyWinDrag) {
				this.qArea.className = aib.cReply + ' de-win';
				updateWinZ(this.qArea);
			} else {
				this.qArea.className = aib.cReply + ' de-win-inpost';
				this.txta.focus();
			}
		};
		closeBtn.onclick = () => this.closeReply();
	}
	_setPlaceholder(val) {
		const el = val === 'captcha' ? this.captcha.textEl : this[val];
		if(el) {
			if(aib.multiFile || Cfg.fileInputs !== 2) {
				el.placeholder = Lng[val][lang];
			} else {
				el.removeAttribute('placeholder');
			}
		}
	}
	_toggleQuickReply(tNum) {
		if(this.oeForm) {
			$q('input[name="oek_parent"]', this.oeForm)?.remove();
			if(tNum) {
				this.oeForm.insertAdjacentHTML('afterbegin',
					`<input type="hidden" value="${ tNum }" name="oek_parent">`);
			}
		}
		if(this.form) {
			if(aib.changeReplyMode && tNum !== this.tNum) {
				aib.changeReplyMode(this.form, tNum);
			}
			$q(`input[name="${ aib.formParent }"]`, this.form)?.remove();
			if(tNum) {
				this.form.insertAdjacentHTML('afterbegin',
					`<input type="hidden" name="${ aib.formParent }" value="${ tNum }">`);
			}
		}
	}
}
