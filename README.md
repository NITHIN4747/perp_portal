# InterviewAce 🎯

InterviewAce is a powerful, locally-hosted, static Interview Preparation Portal. It allows you to upload question banks (PDFs), take timed mock quizzes, get dynamic AI hints, and track your performance with detailed analytics!

---

## 🌟 Features

- **Upload Question Banks**: Extract multiple-choice questions natively from PDFs or Word Documents.
- **Mock Interview Engine**: Customise the number of questions, time limit, and test mode (Exam vs. Practice).
- **AI Assistant Integration**: Get dynamic, step-by-step explanations and math typesetting from Google Gemini.
- **Analytics & History**: Review your past sessions, accuracy, time per question, and download marked PDF answer sheets.
- **Fully Static**: Entirely client-side application (HTML/JS/CSS). Uses `localStorage` for state management and CDN libraries for everything else.

---

## 🚀 How to Use the Application

### 1. Uploading Questions
1. Navigate to the **Upload Questions** tab in the sidebar.
2. Select a PDF or DOCX file containing your multiple-choice questions. 
   *(Note: The parser looks for question numbers followed by text, and standard A/B/C/D option formats. It will automatically detect the correct answer if provided in the format `✓ Correct option: X` or `Answer: X`).*
3. Verify the parsed questions and click **✅ Use These Questions**.

### 2. Configuring the Quiz
1. Go to the **Quiz Settings** tab.
2. Set your desired **Number of Questions** and **Time per Question**.
3. Toggle options like **Shuffle Questions**, **Shuffle Options**, or switch to **Exam Mode** (hides hints and immediate feedback).
4. Save settings and click **Start Quiz**.

### 3. Taking the Quiz
1. Read the question and select the correct option. 
2. Use the **← Previous** or **Next →** buttons to navigate. Your timer freezes and choices are preserved when moving backwards.
3. If you get stuck, click the **💡 AI Hint** button to have the Gemini AI explain the concept without spoiling the final answer!
4. Once finished, navigate to the **Analytics** tab to view your performance charts and download your results as a PDF.

---

## 🤖 Setting Up the Gemini AI Assistant

InterviewAce integrates with the Google Gemini API to generate dynamic, contextual hints for any question.

### Step 1: Get Your Free API Key
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google Account.
3. Click the **"Create API Key"** button.
4. If you don't have a project, create a new one or select an existing Google Cloud project.
5. Copy the generated API Key (it usually starts with `AQ...`).

### Step 2: Paste the Key into InterviewAce
1. Open the InterviewAce portal and click on **Quiz Settings** in the sidebar.
2. Scroll down to the **🤖 Gemini API Key** card.
3. Paste your API Key into the text box.
4. Click **💾 Save Settings** at the bottom of the page.
5. The API key is securely saved directly in your browser's local storage. You're all set!

---

## 🛠️ Hosting the Application

Because this application is 100% static HTML/CSS/JS with no backend required, it can be hosted anywhere for free!

**Option 1: GitHub Pages (Recommended)**
1. Create a new repository on GitHub.
2. Push the contents of this folder to your repository.
3. Go to the repository **Settings** > **Pages**.
4. Set the source branch to `main` (or `master`) and save.
5. Your app will be live at `https://yourusername.github.io/your-repo-name/`.

**Option 2: Vercel / Netlify**
Simply drag and drop this folder into Vercel or Netlify to deploy it instantly!

---

*Happy Interviewing!*
