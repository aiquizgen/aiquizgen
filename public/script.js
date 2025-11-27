document.addEventListener("DOMContentLoaded", () => {
  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href !== '#' && href !== '#') {
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // File Upload and Drag & Drop
  const uploadBtn = document.getElementById("uploadBtn");
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");

  if (uploadBtn && fileInput) uploadBtn.addEventListener("click", () => fileInput.click());
  if (fileInput) fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      handleFiles(e.dataTransfer.files);
    });
  }

  function handleFiles(files) {
    if (!files.length) return;
    const fileNames = Array.from(files).map(f => f.name).join(", ");
    showNotification(`Uploading ${files.length} file(s): ${fileNames}`, "info");
    uploadAndProcessFiles(files);
  }

  // Notifications
  function showNotification(message, type = "info") {
    const notification = document.createElement("div");
    const bgColor = type === "error" ? "var(--discord-danger)" : 
                    type === "success" ? "var(--discord-success)" : 
                    type === "warning" ? "var(--discord-warning)" : 
                    "var(--discord-content)";
    notification.style.cssText = `
      position: fixed; top: 90px; right: 20px; background: ${bgColor};
      color: var(--discord-text-primary); padding: 1rem 1.5rem;
      border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
      border: 1px solid var(--discord-border); z-index: 1000;
      animation: slideIn 0.3s ease-out; max-width: 400px; font-weight: 500;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    const duration = type === "error" ? 5000 : 3000;
    setTimeout(() => {
      notification.style.animation = "slideOut 0.3s ease-out";
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }

  // Upload and process files with backend
  async function uploadAndProcessFiles(files) {
    const dropZone = document.getElementById('dropZone');
    const uploadBtn = document.getElementById('uploadBtn');
    
    try {
      const formData = new FormData();
      Array.from(files).forEach(file => formData.append('files', file));

      // Show loading state
      if (dropZone) {
        dropZone.style.opacity = '0.6';
        dropZone.style.pointerEvents = 'none';
      }
      if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.style.cursor = 'not-allowed';
        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '<span style="display: inline-block; width: 16px; height: 16px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 0.5rem;"></span>Processing...';
      }

      showNotification("Processing files with AI... This may take a moment.", "info");
      
      const response = await fetch('/api/process-files', { 
        method: 'POST', 
        body: formData 
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process files');
      }

      if (data.success) {
        sessionStorage.setItem('explanationData', JSON.stringify(data.explanation));
        sessionStorage.setItem('quizData', JSON.stringify(data.quiz));
        sessionStorage.setItem('filesProcessed', JSON.stringify(data.files_processed));
        sessionStorage.setItem('dataProcessed', 'true');

        showNotification("AI processing complete! Redirecting...", "success");
        setTimeout(() => window.location.href = "explanation.html", 1500);
      } else {
        throw new Error(data.error || 'Processing failed');
      }
    } catch (err) {
      showNotification(`Error: ${err.message}`, "error");
      
      // Restore UI
      if (dropZone) {
        dropZone.style.opacity = '1';
        dropZone.style.pointerEvents = 'auto';
      }
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.style.cursor = 'pointer';
        uploadBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 0.5rem;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          Select Files
        `;
      }
    }
  }

  // ---------- Explanation Page ----------
  const explanationResult = document.getElementById("explanationResult");
  const loadingText = document.getElementById("loadingText");
  const noDataMessage = document.getElementById("noDataMessage");

  if (explanationResult && loadingText) {
    const explanationData = sessionStorage.getItem('explanationData');
    if (!explanationData) {
      loadingText.classList.add("hidden");
      explanationResult.classList.add("hidden");
      if (noDataMessage) noDataMessage.classList.remove("hidden");
    } else {
      const data = JSON.parse(explanationData);
      setTimeout(() => {
        loadingText.classList.add("hidden");
        if (noDataMessage) noDataMessage.classList.add("hidden");
        
        // Handle both array and single object formats
        const sections = Array.isArray(data) ? data : [data];
        
        explanationResult.innerHTML = sections.map(section => {
          const topic = section.topic || "Study Material";
          const content = section.content || (Array.isArray(section) ? section : [section]);
          return `
            <p><strong>Topic:</strong> ${topic}</p>
            ${content.map(p => `<p>${p}</p>`).join('')}
          `;
        }).join('') + `<div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--discord-border);"><button class="btn" onclick="window.location.href='quiz.html'" style="width: 100%;">Take Quiz on This Topic</button></div>`;
        explanationResult.classList.remove("hidden");
      }, 1500);
    }
  }

  // ---------- Quiz Page ----------
  const quizContent = document.getElementById("quizContent");
  const loadingQuiz = document.getElementById("loadingQuiz");
  const noQuizMessage = document.getElementById("noQuizMessage");

  if (quizContent && loadingQuiz) {
    const quizData = sessionStorage.getItem('quizData');
    if (!quizData) {
      loadingQuiz.classList.add("hidden");
      quizContent.classList.add("hidden");
      if (noQuizMessage) noQuizMessage.classList.remove("hidden");
    } else {
      try {
        const data = JSON.parse(quizData);
        
        // Ensure data is an array
        const questions = Array.isArray(data) ? data : (data ? [data] : []);
        
        if (questions.length === 0) {
          loadingQuiz.classList.add("hidden");
          quizContent.classList.add("hidden");
          if (noQuizMessage) noQuizMessage.classList.remove("hidden");
          return;
        }
        
        setTimeout(() => {
          loadingQuiz.classList.add("hidden");
          if (noQuizMessage) noQuizMessage.classList.add("hidden");

          // Build quiz HTML
          const questionsHTML = questions.map((q, idx) => {
            if (!q || !q.question) {
              return '';
            }
            
            const options = Array.isArray(q.options) ? q.options : [];
            
            return `
              <div class="question" data-question-index="${idx}">
                <p><strong>Question ${idx + 1}:</strong> ${q.question}</p>
                <ul>
                  ${options.map(opt => {
                    const optionText = typeof opt === 'string' ? opt : String(opt);
                    const optionLetter = optionText.trim().charAt(0);
                    return `<li data-option="${optionLetter}">${optionText}</li>`;
                  }).join('')}
                </ul>
              </div>
            `;
          }).filter(html => html.trim() !== '').join('');

          quizContent.innerHTML = questionsHTML + `
            <div style="display: flex; gap: 1rem; justify-content: space-between; margin-top: 2rem; flex-wrap: wrap;">
              <button class="btn" style="background: var(--discord-content); color: var(--discord-text-secondary);" onclick="window.location.href='explanation.html'">Back to Explanation</button>
              <button class="btn" id="submitQuiz">Submit All Answers</button>
            </div>
          `;

          quizContent.classList.remove("hidden");
          initializeQuiz(questions);
        }, 1500);
      } catch (error) {
        loadingQuiz.classList.add("hidden");
        quizContent.classList.add("hidden");
        if (noQuizMessage) noQuizMessage.classList.remove("hidden");
        showNotification("Error loading quiz data. Please try uploading files again.", "error");
      }
    }
  }

  // Quiz interaction
  function initializeQuiz(quizData) {
    const questions = document.querySelectorAll(".question");
    const submitBtn = document.getElementById("submitQuiz");

    // Make sure quizData is an array
    const questionsArray = Array.isArray(quizData) ? quizData : [quizData];

    // Set up click handlers for each question
    questions.forEach((qElem, idx) => {
      const options = qElem.querySelectorAll("li");
      options.forEach(opt => {
        opt.addEventListener("click", () => {
          // Remove selection from other options in this question
          options.forEach(o => o.classList.remove("selected"));
          opt.classList.add("selected");
        });
      });
    });

    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        let allAnswered = true;
        let score = 0;
        const totalQuestions = questions.length;

        // Check if all questions are answered
        questions.forEach((qElem, idx) => {
          const selected = qElem.querySelector("li.selected");
          if (!selected) {
            allAnswered = false;
          }
        });

        if (!allAnswered) {
          showNotification("Please answer all questions before submitting!", "warning");
          return;
        }

        // Evaluate answers
        questions.forEach((qElem, idx) => {
          const options = qElem.querySelectorAll("li");
          const correctAnswer = questionsArray[idx]?.correctAnswer || "B";
          
          options.forEach(opt => {
            const optionText = opt.textContent.trim();
            const optionLetter = optionText.charAt(0);
            
            if (optionLetter === correctAnswer) {
              opt.classList.add("correct");
              if (opt.classList.contains("selected")) {
                score++;
              }
            } else if (opt.classList.contains("selected")) {
              opt.classList.add("incorrect");
            }
            opt.style.pointerEvents = "none";
          });
        });

        // Disable submit button and show score
        submitBtn.disabled = true;
        submitBtn.style.cursor = "not-allowed";
        submitBtn.textContent = `Quiz Complete! Score: ${score}/${totalQuestions}`;
        
        // Show score notification
        const percentage = Math.round((score / totalQuestions) * 100);
        showNotification(`Quiz completed! You scored ${score}/${totalQuestions} (${percentage}%)`, 
          percentage >= 70 ? "success" : percentage >= 50 ? "info" : "error");
      });
    }
  }
});
