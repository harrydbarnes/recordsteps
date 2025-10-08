# Record Steps - Chrome Extension

This Chrome extension is a developer tool designed to aid in the creation of browser automation scripts. It records user interactions on a webpage, such as clicks, keyboard inputs, and navigation events, and compiles them into a structured JSON format. This recording can then be used as a foundation for writing automated test scripts for frameworks like Puppeteer, Playwright, or Selenium.

## Features

- **Click and Keyboard Recording**: Captures detailed information about user clicks and keyboard actions.
- **Input Sequencing**: Groups related keyboard events within a single input field into a cohesive sequence.
- **Navigation Tracking**: Automatically records page loads and transitions.
- **Attribute Monitoring**: Uses a `MutationObserver` to track changes to element attributes like `class`, `disabled`, etc.
- **Shadow DOM Support**: Accurately generates selectors for elements within Shadow DOMs.
- **Data Export**: Allows the recorded session to be downloaded as a JSON file.
- **State Persistence**: Safely stores recording state and data using `chrome.storage`.

## Project Structure

The extension is composed of the following main files:

- **`manifest.json`**: The core configuration file for the Chrome extension. It defines permissions, scripts, and other essential metadata.
- **`background.js`**: The service worker that runs in the background. It manages the extension's state (e.g., `isRecording`), handles the injection of content scripts, and listens for messages from other parts of the extension.
- **`content.js`**: A script injected into the web pages being recorded. It listens for user interactions (clicks, key presses, etc.), gathers detailed information about the target elements, and sends this data to the background script.
- **`popup.html`**: The HTML structure for the extension's popup UI.
- **`popup.js`**: The script that controls the popup's functionality, including starting/stopping the recording, downloading the data, and updating the UI based on the current state.

## Setup for Development

To set up the extension for local development, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone <URL-of-this-repository>
    ```
2.  **Load the extension in Chrome:**
    - Open Google Chrome and navigate to `chrome://extensions`.
    - Enable "Developer mode" using the toggle switch in the top-right corner.
    - Click the "Load unpacked" button.
    - Select the directory where you cloned the repository.

The extension should now be installed and ready for development. Any changes you make to the source files will be reflected after you reload the extension from the `chrome://extensions` page.

## How to Use

1.  **Start Recording**:
    - Click on the extension's icon in the Chrome toolbar to open the popup.
    - Click the "Start Recording" button. The status will change to "Recording...".

2.  **Perform Actions**:
    - Navigate and interact with any webpage as you normally would. The extension will capture your clicks, keystrokes, and other relevant events in the background.

3.  **Stop Recording**:
    - Open the popup again and click the "Stop Recording" button.

4.  **Download Data**:
    - Click the "Download Recording" button to save the captured session as a JSON file.

5.  **Clear Data**:
    - Click the "Clear Recording" button to erase all captured data from the extension's storage. This action is irreversible.