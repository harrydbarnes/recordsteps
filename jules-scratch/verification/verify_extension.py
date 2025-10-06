import os
from playwright.sync_api import sync_playwright, expect

def test_extension_popup():
    # Path to the extension directory
    extension_path = os.path.abspath(".")

    with sync_playwright() as p:
        # Launch a persistent context with the extension loaded
        context = p.chromium.launch_persistent_context(
            "",  # An empty string for user_data_dir creates a temporary directory
            headless=True,
            channel="chromium",
            args=[
                f"--disable-extensions-except={extension_path}",
                f"--load-extension={extension_path}",
            ],
        )

        # Get the extension ID
        # For manifest v3, the background script is a service worker
        service_worker = context.service_workers[0]
        if not service_worker:
            service_worker = context.wait_for_event("serviceworker")

        extension_id = service_worker.url.split('/')[2]

        # Go to the popup page
        popup_page = context.new_page()
        popup_page.goto(f"chrome-extension://{extension_id}/popup.html")

        # Verify the main heading is visible
        heading = popup_page.locator("h2")
        expect(heading).to_have_text("Click Recorder")

        # Verify the 'Start Recording' button is present
        start_button = popup_page.locator("#startBtn")
        expect(start_button).to_be_visible()
        expect(start_button).to_have_text("Start Recording")

        # Take a screenshot of the popup
        popup_page.screenshot(path="jules-scratch/verification/popup.png")

        # Close the context
        context.close()

# Run the test
test_extension_popup()
print("Verification script executed successfully.")