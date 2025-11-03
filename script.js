// Google Sheets Configuration
const SPREADSHEET_ID = '1ajnPZy6u6nw-g5GE5ZbortN53JZ9SBkl9RYB9TxMFqs';
const SHEET_NAME = 'Phrases'; // Nome da aba

// Google Apps Script Web App URL
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbx8ZLe2vqROfuMoImCXfHDFzfksfDi3h6oZkfmCx2bP-6gYLRjKNIYSLkHGgr2j-Sw/exec';

// CSV export URL for reading - vamos usar a aba "Frases"
const CSV_URL_GID_0 = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=0`;
const CSV_URL_GID_98642087 = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=98642087`;
const CSV_URL_NO_GID = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

// DOM Elements
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const phraseContainer = document.getElementById('phraseContainer');
const phraseText = document.getElementById('phraseText');
const starsContainer = document.getElementById('starsContainer');
const endMessage = document.getElementById('endMessage');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let phrases = []; // Array de objetos: {text: string, rating: number, index: number, hide: boolean}
let userVotes = []; // Array de votos do usuário atual: [0-5 ou null]
let userId = null; // ID único do usuário
let currentPhraseIndex = -1; // Índice da frase atual sendo exibida

// Initialize user ID and votes from localStorage
function initUserData() {
    userId = localStorage.getItem('userId');
    if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('userId', userId);
    }
    
    const savedVotes = localStorage.getItem('userVotes');
    if (savedVotes) {
        userVotes = JSON.parse(savedVotes);
    } else {
        userVotes = [];
    }
    
    console.log('User ID:', userId);
    console.log('User votes:', userVotes);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Verify all elements exist
    if (!phraseContainer || !phraseText || !starsContainer || !progressFill || !progressText) {
        console.error('Some DOM elements are missing');
        if (error) {
            error.textContent = 'Erro ao inicializar a página. Recarregue a página.';
            error.style.display = 'block';
        }
        return;
    }
    
    // Wire control buttons if present
    const addBtn = document.getElementById('fabAddPhrase');
    const clearBtn = document.getElementById('clearEntryBtn');
    if (addBtn) {
        addBtn.addEventListener('click', onAddPhraseClick);
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', onClearEntryClick);
        // Hidden by default; will be shown in showEndMessage()
        clearBtn.style.display = 'none';
    }

    // Initialize progress bar
    updateProgress();
    
    // Initialize user data
    initUserData();
    
    // Load data on page load
    loadData();
});

// Handle add new phrase
function onAddPhraseClick() {
    const phrase = prompt('Digite a nova frase:');
    if (!phrase) return;
    const payload = {
        action: 'append',
        data: [phrase]
    };
    // Disable buttons to prevent double submit
    toggleControls(true);
    submitViaHiddenFormVote(payload, () => {
        console.log('Nova frase adicionada com sucesso');
        // Reload to reflect new data at the bottom
        window.location.reload();
    }, (err) => {
        console.error('Falha ao adicionar frase:', err);
        showError('Falha ao adicionar frase. Verifique permissões do Apps Script.');
        toggleControls(false);
    });
}

// Handle clear entry (local + sheet user row)
function onClearEntryClick() {
    if (!userId) {
        initUserData();
    }
    const confirmClear = confirm('Isso irá limpar seus votos locais e remover sua entrada no Sheets. Continuar?');
    if (!confirmClear) return;

    const payload = {
        action: 'clearUser',
        userId: userId
    };
    toggleControls(true);
    submitViaHiddenFormVote(payload, () => {
        try {
            localStorage.removeItem('userVotes');
            localStorage.removeItem('userId');
        } catch (e) {}
        console.log('Entrada do usuário limpa. Recarregando...');
        window.location.reload();
    }, (err) => {
        console.error('Falha ao limpar entrada:', err);
        showError('Falha ao limpar entrada. Verifique permissões do Apps Script.');
        toggleControls(false);
    });
}

function toggleControls(disabled) {
    const addBtn = document.getElementById('fabAddPhrase');
    const clearBtn = document.getElementById('clearEntryBtn');
    if (addBtn) addBtn.disabled = disabled;
    if (clearBtn) clearBtn.disabled = disabled;
}

// Helpers
function toBoolean(value) {
    if (value === undefined || value === null) return false;
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'y' || s === 'yes' || s === 'sim';
}

// Load data from Google Sheets
async function loadData() {
    showLoading(true);
    hideError();
    
    // Try multiple URLs in order of preference
    const urls = [
        CSV_URL_GID_0,
        CSV_URL_GID_98642087,
        CSV_URL_NO_GID
    ];
    
    let csvText = null;
    let lastError = null;
    
    for (let i = 0; i < urls.length; i++) {
        try {
            console.log(`Tentativa ${i + 1}: Carregando de`, urls[i]);
            const response = await fetch(urls[i]);
            
            if (!response.ok) {
                console.warn(`URL ${i + 1} falhou: HTTP ${response.status}`);
                continue;
            }
            
            csvText = await response.text();
            console.log('CSV recebido, tamanho:', csvText.length);
            console.log('Primeiras 200 caracteres:', csvText.substring(0, 200));
            
            if (csvText && csvText.trim() !== '') {
                break; // Success, exit loop
            }
        } catch (err) {
            console.warn(`Erro ao tentar URL ${i + 1}:`, err);
            lastError = err;
            continue;
        }
    }
    
    if (!csvText || csvText.trim() === '') {
        showEmptyState(true);
        showTable(false);
        showError('Não foi possível acessar a planilha. Verifique se ela está publicada como "Qualquer pessoa com o link pode visualizar".');
        console.error('Todas as URLs falharam. Último erro:', lastError);
        showLoading(false);
        return;
    }
    
    try {
        const rows = parseCSV(csvText);
        console.log('Linhas parseadas:', rows.length);
        
        if (rows.length === 0) {
            showEmptyState(true);
            showTable(false);
            showError('A planilha não contém dados.');
            showLoading(false);
            return;
        }
        
        // Primeira linha pode ser cabeçalho - pular se for "Phrases", "Rating" ou "Hide"
        let startIndex = 0;
        if (rows.length > 0 && rows[0].length > 0) {
            const firstCell = rows[0][0].toLowerCase().trim();
            if (firstCell === 'phrases' || firstCell === 'frases' || firstCell === 'rating' || firstCell === 'hide') {
                startIndex = 1; // Pular cabeçalho
            }
        }
        
        // Extrair frases da coluna A, ratings da coluna B, hide da coluna C
        phrases = rows
            .slice(startIndex) // Pula cabeçalho se houver
            .map((row, idx) => ({
                text: row[0] || '',
                rating: parseInt(row[1]) || 0,
                index: idx,
                hide: toBoolean(row[2])
            }))
            .filter(phrase => phrase.text && phrase.text.trim() !== ''); // Remove linhas vazias
        
        // Sincronizar tamanho do cache local com a quantidade de frases
        // 1) Truncar votos extras (caso a planilha tenha menos frases agora)
        if (userVotes.length > phrases.length) {
            userVotes = userVotes.slice(0, phrases.length);
        }
        // 2) Expandir se necessário (novas frases adicionadas)
        while (userVotes.length < phrases.length) {
            userVotes.push(null); // null significa que ainda não votou
        }
        // Persistir sincronização
        try {
            localStorage.setItem('userVotes', JSON.stringify(userVotes));
        } catch (e) {}
        
        console.log('Frases encontradas:', phrases.length);
        console.log('User votes:', userVotes);
        
        if (phrases.length === 0) {
            showEndMessage();
            showLoading(false);
            return;
        }
        
        // Update progress
        updateProgress();
        
        // Show next unvoted visible phrase
        showNextPhrase();
    } catch (err) {
        console.error('Erro ao processar CSV:', err);
        showError('Erro ao processar os dados: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// Parse CSV text into array of arrays
function parseCSV(text) {
    const rows = [];
    const lines = text.split('\n');
    
    for (let line of lines) {
        if (line.trim() === '') continue;
        
        const row = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        row.push(current.trim());
        rows.push(row);
    }
    
    return rows;
}

// Show next unvoted phrase (used on initial load)
function showNextPhrase() {
    // Find phrases that haven't been voted yet
    const unvotedPhrases = phrases
        .map((phrase, index) => ({ phrase, index }))
        .filter(({ phrase, index }) => !phrase.hide && (userVotes[index] === null || userVotes[index] === undefined));
    
    if (unvotedPhrases.length === 0) {
        // All phrases have been voted
        showEndMessage();
        return;
    }
    
    // Pick a random unvoted phrase
    const randomIndex = Math.floor(Math.random() * unvotedPhrases.length);
    const selected = unvotedPhrases[randomIndex];
    
    displayPhrase(selected);
}

// Show/hide loading indicator for phrase transition
function showPhraseLoading(show) {
    let loadingOverlay = document.getElementById('phraseLoadingOverlay');
    
    if (show && !loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'phraseLoadingOverlay';
        loadingOverlay.className = 'phrase-loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="loading-spinner-small"></div>
            <p>Carregando próxima frase...</p>
        `;
        phraseContainer.appendChild(loadingOverlay);
    } else if (!show && loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            if (loadingOverlay.parentNode) {
                loadingOverlay.parentNode.removeChild(loadingOverlay);
            }
        }, 300);
    }
}

// Render star rating (0-5)
function renderStars() {
    starsContainer.innerHTML = '';
    
    const hasVoted = userVotes[currentPhraseIndex] !== null && userVotes[currentPhraseIndex] !== undefined;
    const currentRating = hasVoted ? userVotes[currentPhraseIndex] : 0;
    
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.className = 'star';
        // Always show filled stars for the selected rating
        star.textContent = i <= currentRating ? '⭐️' : '☆';
        star.dataset.rating = i;
        
        // If voted, disable interactions; otherwise enable
        if (hasVoted) {
            star.style.cursor = 'default';
            star.style.pointerEvents = 'none';
            star.style.opacity = i <= currentRating ? '1' : '0.3';
        } else {
            star.style.cursor = 'pointer';
            star.style.pointerEvents = 'auto';
            // Initial state: unfilled stars should have 0.3 opacity (same as after mouseout)
            star.style.opacity = i <= currentRating ? '1' : '0.3';
            
            star.addEventListener('click', () => vote(currentPhraseIndex, i));
            star.addEventListener('mouseenter', () => {
                // On hover, show preview of that rating
                const stars = starsContainer.querySelectorAll('.star');
                stars.forEach((s, idx) => {
                    const starNum = idx + 1;
                    s.textContent = starNum <= i ? '⭐️' : '☆';
                    s.style.opacity = starNum <= i ? '1' : '0.3';
                });
            });
        }
        
        starsContainer.appendChild(star);
    }
    
    // Reset hover when mouse leaves (only if not voted)
    if (!hasVoted) {
        const handleMouseLeave = () => {
            const stars = starsContainer.querySelectorAll('.star');
            stars.forEach((star, index) => {
                const starNumber = index + 1;
                star.textContent = starNumber <= currentRating ? '⭐️' : '☆';
                star.style.opacity = starNumber <= currentRating ? '1' : '0.3';
            });
        };
        starsContainer.removeEventListener('mouseleave', handleMouseLeave);
        starsContainer.addEventListener('mouseleave', handleMouseLeave);
    }
}

// Highlight stars on hover (or show current rating)
function highlightStars(rating) {
    const stars = starsContainer.querySelectorAll('.star');
    stars.forEach((star, index) => {
        const starNumber = index + 1;
        star.textContent = starNumber <= rating ? '⭐️' : '☆';
    });
}

// Vote function (0-5 stars)
async function vote(phraseIndex, rating) {
    // Check if already voted
    if (userVotes[phraseIndex] !== null && userVotes[phraseIndex] !== undefined) {
        return; // Already voted, ignore
    }
    
    // Disable all interactions immediately
    disableInteractions(true);
    
    // Update local cache immediately
    userVotes[phraseIndex] = rating;
    localStorage.setItem('userVotes', JSON.stringify(userVotes));
    
    // Update stars display to show selected rating (keep them filled and disable)
    renderStars();
    
    // Start loading next phrase in background IMMEDIATELY
    const nextPhrasePromise = prepareNextPhrase();
    
    // Add flashy effects
    addVoteEffects(rating);
    
    // Update progress immediately
    updateProgress();
    
    // Send vote to server (fire and forget - don't wait for response)
    submitVote(phraseIndex, rating).then(() => {
        console.log('Vote submitted successfully');
    }).catch((err) => {
        console.error('Error submitting vote:', err);
        showError('Aviso: Voto pode não ter sido salvo. Verifique sua conexão.');
    });
    
    // Wait for animation to complete, then show next phrase
    setTimeout(async () => {
        showPhraseLoading(true);
        
        // Wait for next phrase to be ready
        const nextPhrase = await nextPhrasePromise;
        
        setTimeout(() => {
            // Show the prepared phrase
            displayPhrase(nextPhrase);
            showPhraseLoading(false);
            disableInteractions(false);
        }, 300);
    }, 1000); // Wait for animation
}

// Disable/enable user interactions
function disableInteractions(disable) {
    const stars = starsContainer.querySelectorAll('.star');
    stars.forEach(star => {
        star.style.pointerEvents = disable ? 'none' : 'auto';
        star.style.cursor = disable ? 'default' : 'pointer';
    });
    
    phraseContainer.style.pointerEvents = disable ? 'none' : 'auto';
}

// Prepare next phrase in background (returns promise)
async function prepareNextPhrase() {
    return new Promise((resolve) => {
        // Find phrases that haven't been voted yet
    const unvotedPhrases = phrases
        .map((phrase, index) => ({ phrase, index }))
        .filter(({ phrase, index }) => !phrase.hide && (userVotes[index] === null || userVotes[index] === undefined));
        
        if (unvotedPhrases.length === 0) {
            resolve(null); // No more phrases
            return;
        }
        
        // Pick a random unvoted phrase
        const randomIndex = Math.floor(Math.random() * unvotedPhrases.length);
        const selected = unvotedPhrases[randomIndex];
        
        resolve(selected);
    });
}

// Display a prepared phrase
function displayPhrase(selected) {
    if (!selected) {
        showEndMessage();
        return;
    }
    
    currentPhraseIndex = selected.index;
    phraseText.innerHTML = `"${selected.phrase.text}"`;
    renderStars();
    phraseContainer.style.display = 'flex';
    endMessage.style.display = 'none';
}

// Add flashy effects after voting
function addVoteEffects(rating) {
    // Add animation to phrase container
    phraseContainer.style.animation = 'none';
    setTimeout(() => {
        phraseContainer.style.animation = 'voteFlash 0.6s ease-out';
    }, 10);
    
    // Add sparkle effect to stars
    const stars = starsContainer.querySelectorAll('.star');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.style.animation = 'starPop 0.5s ease-out';
            star.style.animationDelay = (index * 0.1) + 's';
        }
    });
    
    // Show success message temporarily
    const successMsg = document.createElement('div');
    successMsg.className = 'vote-success';
    successMsg.textContent = '✓ Voto registrado!';
    phraseContainer.appendChild(successMsg);
    
    setTimeout(() => {
        successMsg.style.opacity = '0';
        setTimeout(() => {
            if (successMsg.parentNode) {
                successMsg.parentNode.removeChild(successMsg);
            }
        }, 300);
    }, 1500);
}

// Submit vote to server (rating 0-5)
async function submitVote(phraseIndex, rating) {
    return new Promise((resolve, reject) => {
        // Always send ALL votes for this user
        // Make sure the array has the right length
        const allVotes = [...userVotes];
        while (allVotes.length < phrases.length) {
            allVotes.push(null);
        }
        // Update the current vote in the array
        allVotes[phraseIndex] = rating;
        
        const voteData = {
            action: 'vote',
            userId: userId,
            phraseIndex: phraseIndex,
            rating: rating, // 0-5 stars - the current vote
            votes: allVotes.map(v => v === null || v === undefined ? '0' : v.toString()).join(',') // ALL votes as comma-separated string; send 0 if no vote
        };
        
        console.log('Submitting vote:', voteData);
        console.log('All votes being sent:', voteData.votes);
        
        submitViaHiddenFormVote(voteData, resolve, reject);
    });
}

// Update progress bar
function updateProgress() {
    if (phrases.length === 0) {
        progressFill.style.width = '0%';
        progressText.textContent = '0 / 0';
        return;
    }
    
    // Progress should consider only visible (not hidden) phrases
    const visibleIndices = phrases
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => !p.hide)
        .map(({ idx }) => idx);

    const votedCount = visibleIndices.filter(idx => userVotes[idx] !== null && userVotes[idx] !== undefined).length;
    const totalCount = visibleIndices.length || 0;
    const percentage = (votedCount / totalCount) * 100;
    
    progressFill.style.width = percentage + '%';
    progressText.textContent = `${votedCount} / ${totalCount}`;
}

// Show end message
function showEndMessage() {
    phraseContainer.style.display = 'none';
    endMessage.style.display = 'block';
    updateProgress(); // Update progress to show 100%
    // Reveal clear button at the end
    const clearBtn = document.getElementById('clearEntryBtn');
    if (clearBtn) clearBtn.style.display = 'inline-flex';
}


// Submit vote via hidden iframe - most reliable method for Google Apps Script
function submitViaHiddenFormVote(voteData, resolve, reject) {
    console.log('Preparing to submit vote:', voteData);
    console.log('Web App URL:', WEB_APP_URL);
    
    // Check if URL is configured
    if (!WEB_APP_URL || WEB_APP_URL.includes('YOUR_GOOGLE_APPS_SCRIPT_URL')) {
        reject(new Error('Web App URL não configurada. Configure no script.js'));
        return;
    }
    
    const payload = JSON.stringify(voteData);
    console.log('Payload to send:', payload);
    
    // Use iframe method - most reliable for Google Apps Script
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = WEB_APP_URL;
    form.style.display = 'none';
    form.enctype = 'application/x-www-form-urlencoded';
    form.acceptCharset = 'UTF-8';
    
    // Create hidden iframe to receive response
    const iframe = document.createElement('iframe');
    const iframeName = 'voteFrame_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    iframe.name = iframeName;
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.position = 'absolute';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    
    form.target = iframeName;
    
    const dataInput = document.createElement('input');
    dataInput.type = 'hidden';
    dataInput.name = 'postData';
    dataInput.value = payload;
    
    form.appendChild(dataInput);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    
    console.log('Submitting form to:', WEB_APP_URL);
    console.log('Form data:', formDataToString(form));
    
    let isComplete = false;
    let resolved = false;
    
    const completeTimeout = setTimeout(() => {
        if (!isComplete && !resolved) {
            isComplete = true;
            resolved = true;
            console.log('⏱ Vote submission timeout - assuming success');
            cleanup();
            resolve();
        }
    }, 3000);
    
    iframe.onload = function() {
        if (!isComplete && !resolved) {
            isComplete = true;
            resolved = true;
            clearTimeout(completeTimeout);
            console.log('✅ Iframe loaded - vote submission completed');
            // Try to read response from iframe (may not work due to CORS)
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const responseText = iframeDoc.body ? iframeDoc.body.textContent : 'No response body';
                console.log('Response from server:', responseText.substring(0, 200));
            } catch (e) {
                console.log('Could not read iframe response (CORS restriction)');
            }
            cleanup();
            resolve();
        }
    };
    
    iframe.onerror = function() {
        if (!isComplete && !resolved) {
            isComplete = true;
            resolved = true;
            clearTimeout(completeTimeout);
            console.warn('⚠️ Iframe error, but submission may have succeeded');
            cleanup();
            resolve(); // Assume success to not block UX
        }
    };
    
    function cleanup() {
        setTimeout(() => {
            try {
                if (form.parentNode) {
                    document.body.removeChild(form);
                }
                if (iframe.parentNode) {
                    document.body.removeChild(iframe);
                }
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        }, 1000);
    }
    
    try {
        form.submit();
        console.log('✅ Form submitted successfully');
    } catch (err) {
        if (!resolved) {
            resolved = true;
            clearTimeout(completeTimeout);
            console.error('❌ Error submitting form:', err);
            cleanup();
            reject(err);
        }
    }
}

// Helper to see what data is being sent
function formDataToString(form) {
    const inputs = form.querySelectorAll('input');
    const data = {};
    inputs.forEach(input => {
        if (input.type === 'hidden') {
            data[input.name] = input.value;
        }
    });
    return JSON.stringify(data, null, 2);
}

// Fallback: Submit via hidden iframe (completely invisible)
function submitViaIframe(voteData, resolve, reject) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = WEB_APP_URL;
    form.style.display = 'none';
    form.enctype = 'application/x-www-form-urlencoded';
    form.acceptCharset = 'UTF-8';
    
    // Create completely hidden iframe
    const iframe = document.createElement('iframe');
    const iframeName = 'voteFrame_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    iframe.name = iframeName;
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.position = 'absolute';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.opacity = '0';
    iframe.style.visibility = 'hidden';
    
    form.target = iframeName;
    
    const payload = JSON.stringify(voteData);
    const dataInput = document.createElement('input');
    dataInput.type = 'hidden';
    dataInput.name = 'postData';
    dataInput.value = payload;
    
    form.appendChild(dataInput);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    
    console.log('Submitting vote via hidden iframe POST to:', WEB_APP_URL);
    
    // Wait a tiny bit for iframe to be ready, then submit
    setTimeout(() => {
        let isComplete = false;
        const completeTimeout = setTimeout(() => {
            if (!isComplete) {
                isComplete = true;
                console.log('Vote submission completed (timeout)');
                cleanup();
                resolve();
            }
        }, 3000);
        
        iframe.onload = () => {
            if (!isComplete) {
                isComplete = true;
                clearTimeout(completeTimeout);
                console.log('Vote submitted successfully via iframe');
                cleanup();
                resolve();
            }
        };
        
        iframe.onerror = () => {
            if (!isComplete) {
                isComplete = true;
                clearTimeout(completeTimeout);
                console.warn('Iframe error, but vote may have been submitted');
                cleanup();
                resolve(); // Assume success to not block UX
            }
        };
        
        function cleanup() {
            setTimeout(() => {
                try {
                    if (form.parentNode) {
                        document.body.removeChild(form);
                    }
                    if (iframe.parentNode) {
                        document.body.removeChild(iframe);
                    }
                } catch (e) {
                    console.warn('Cleanup error:', e);
                }
            }, 1000);
        }
        
        try {
            form.submit();
            console.log('Form submitted via iframe');
        } catch (err) {
            if (!isComplete) {
                isComplete = true;
                clearTimeout(completeTimeout);
                console.error('Error submitting form:', err);
                cleanup();
                reject(err);
            }
        }
    }, 100); // Small delay to ensure iframe is ready
}

// UI Helper functions
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

function showError(message) {
    error.textContent = message;
    error.style.display = 'block';
}

function hideError() {
    error.style.display = 'none';
}


