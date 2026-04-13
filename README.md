# SASTOCK Metadata & Prompt Studio

High-performance microstock metadata generator and AI Prompt engineering tool, optimized for Gemini API rotation and concurrent processing.

## 🚀 Key Features

### 1. Advanced Metadata Studio
- **Parallel Processing**: Generate metadata for multiple files simultaneously (concurrency limit) for maximum speed.
- **Real-time Logging**: Track background processes (conversions, AI calls, and success/errors) via a built-in console.
- **Microstock Optimized**: Supports image, video, SVG, and EPS.
- **Smart Categorization**: Automatically generates official categories for Adobe Stock (Numeric) and Shutterstock (Names).
- **Precision Export**: Standardized CSV exports for Adobe Stock, Shutterstock, Vecteezy, and Freepik.

### 2. Advanced Prompt Studio
- **Dual Mode**: 
  - **AUTO**: AI intelligently fills in details (expression, activity, background).
  - **MANUAL**: Precise control over every visual element.
- **Batch Generation**: Create up to 20 unique prompts in one click.
- **Anti-Duplication**: Uses Jaccard Similarity to ensure high variety in every batch.
- **Language Support**: Seamlessly switch between English and Bahasa Indonesia.

### 3. Core Engine
- **Gemini Key Rotation**: Built-in round-robin rotation for free-tier Gemini API keys.
- **Vector Support**: Built-in conversion from SVG/EPS to visual previews for AI analysis.
- **Authenticated Access**: Secure multi-user login and session management.

## 🛠 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/rdkcho33/sastock.git
   cd sastock
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` in your browser.

## ☁️ VPS Deployment (Production)

To run in production (with SSL and domain):
1. Install **Node.js 20+** and **PM2**.
2. Configure **Nginx** as a reverse proxy for port 3000.
3. Use **Certbot (Let's Encrypt)** for HTTPS.
4. Ensure `sastock.db` has write permissions for the app user.

---
Developed for professional microstock contributors.
