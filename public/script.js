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
let activeNotification = null;

function showNotification(message, type = "info") {
  // Remove existing notification instantly
  if (activeNotification) {
    activeNotification.remove();
    activeNotification = null;
  }

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);
  activeNotification = notification;

  const duration = type === "error" ? 5000 : 3000;

  setTimeout(() => {
    if (!notification) return;

    notification.style.animation = "slideOut 0.35s ease-out";
    setTimeout(() => {
      if (notification === activeNotification) {
        notification.remove();
        activeNotification = null;
      }
    }, 350);
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
      
      // FIX: Render immediately if data exists
      loadingText.classList.add("hidden");
      if (noDataMessage) noDataMessage.classList.add("hidden");
      
      // Handle both array and single object formats
      const sections = Array.isArray(data) ? data : [data];
      explanationResult.innerHTML = sections.map(section => {
        const topic = section.topic || "Study Material";
        const content = section.content || (Array.isArray(section) ? section : [section]);
        
        // FIX: Changed to use the new 'explanation-topic-title' class for a blue underline, removing "Topic: "
        return `
          <h3 class="explanation-topic-title">${topic}</h3>
          ${content.map(p => `<p>${p}</p>`).join('')}
        `;
      }).join('') + `
        <div style="margin-top: 2rem;">
            <button class="btn" onclick="window.location.href='quiz.html'">Take Quiz</button>
        </div>
      `;
      explanationResult.classList.remove("hidden");
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
        const questions = JSON.parse(quizData);
        if (!Array.isArray(questions) || questions.length === 0) throw new Error("Quiz data is empty or invalid format.");
        
        // FIX: Render immediately if data exists
        loadingQuiz.classList.add("hidden");
        if (noQuizMessage) noQuizMessage.classList.add("hidden");
        
        const totalQuestions = questions.length;
        quizContent.innerHTML = questions.map((q, index) => {
          const optionsHtml = (q.options || []).map(option => `
            <li data-index="${option.charAt(0)}">${option}</li>
          `).join('');

          return `
            <div class="question" data-question-index="${index}">
              <p>${index + 1}. ${q.question}</p>
              <ul>${optionsHtml}</ul>
            </div>
          `;
        }).join('') + `
          <div style="margin-top: 2.5rem; text-align: center; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-secondary" onclick="window.location.href='explanation.html'">Back to Explanation</button>
            <button class="btn" id="submitQuiz">Submit All Answers</button>
          </div>
        `;
        quizContent.classList.remove("hidden");
        initializeQuiz(questions);

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
    questions.forEach(qElem => {
      const options = qElem.querySelectorAll("li");
      options.forEach(opt => {
        opt.addEventListener('click', function() {
          if (submitBtn.disabled) return;
          // Remove selected from all other options in this question
          options.forEach(o => o.classList.remove("selected"));
          // Add selected to the clicked option
          this.classList.add("selected");
        });
      });
    });

    // Submit handler
    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        let score = 0;
        const totalQuestions = questions.length;
        let allAnswered = true;

        // Check if all questions are answered
        questions.forEach(qElem => {
          if (!qElem.querySelector(".selected")) {
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
