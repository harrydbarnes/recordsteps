from playwright.sync_api import sync_playwright
import os

def verify_popup():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the popup.html file
        cwd = os.getcwd()
        popup_path = f"file://{cwd}/popup.html"
        print(f"Loading {popup_path}")
        page.goto(popup_path)

        # Wait for the dropdown and description to be visible
        page.wait_for_selector("#loggingLevel")
        page.wait_for_selector("#loggingDescription")

        # Take a screenshot of the initial state
        screenshot_path = "verification_popup_updated.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_popup()
