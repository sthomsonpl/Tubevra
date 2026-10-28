# Privacy Policy

[![Czytaj po polsku](https://img.shields.io/badge/PL-Czytaj_po_polsku-2563eb?style=for-the-badge&labelColor=18181b)](PRIVACY_PL.md)

## Local data

Tubevra stores your settings, User-Agent presets, extension preferences and
YouTube browser data on your device. Cookies, sign-in sessions, site storage and
caches use a separate profile from your regular browser. Settings are stored in
ordinary JSON files.

The usual profile locations are:

- Windows: `%APPDATA%\Tubevra`
- macOS: `~/Library/Application Support/Tubevra`
- Linux: `$XDG_CONFIG_HOME/Tubevra` or `~/.config/Tubevra`

Portable builds also use the normal user profile.

## YouTube and Google

Tubevra connects directly to YouTube TV. Google/YouTube receive your IP address,
request and browser information, selected User-Agent, applicable cookies and
activity such as searches and video requests. Activity may be linked to your
Google account if you are signed in. Some sign-in flows are currently unsupported.

Google's use of this information, including analytics, advertising, retention and
international transfers, follows the [Google Privacy Policy](https://policies.google.com/privacy)
and your account settings. Adblock does not guarantee protection from tracking.

## SponsorBlock

SponsorBlock is **disabled by default**. When enabled, Tubevra fetches sponsor
segments from `sponsor.ajay.app` using the first four characters of a locally
computed SHA-256 hash of the video ID. The full ID is matched locally.

Requests use a separate session without YouTube cookies or account credentials.
Tubevra sends no SponsorBlock user ID, votes, submissions or skip statistics.
The service and its hosting/proxy providers still receive your IP address and
request metadata; the hash prefix does not guarantee anonymity. Results are
cached only in memory and cleared when the extension stops or the app exits.

See [SponsorBlock's privacy policy](https://gist.github.com/ajayyy/aa9f8ded2b573d4f73a3ffa0ef74f796)
and [third-party notices](THIRD_PARTY_NOTICES.md). Disable the extension to stop
further requests.

## Diagnostics and external links

Tubevra has no built-in analytics, automatic crash-report uploads or automatic
update checks. This does not cover data collected by YouTube, SponsorBlock or Return YouTube Dislike.
Errors appear locally and may be written to the console. Electron/Chromium or
your operating system may also keep local diagnostics. Review logs before sharing
them, as they may contain file paths and technical details.

Links to GitHub, Return YouTube Dislike and SponsorBlock open in your
default browser and use its profile
and the destination's privacy rules.

## Removing your data

Settings remain until changed or removed. Site data follows YouTube's expiry
rules and Chromium's storage management. Restarting or changing User-Agent does
not clear your YouTube session.

There is no built-in data-clearing control. Fully quit Tubevra and delete its
profile directory to remove local settings and site data. The Windows uninstaller
preserves this directory. Backups may retain copies. Local deletion does not
erase data held by external services; use their account and privacy controls.

## Data protection rights

Where GDPR applies, you may have rights to access, correction, deletion,
restriction, portability and objection, and to withdraw consent where processing
relies on it, subject to legal conditions. You may complain to a data protection
supervisory authority. See the [European Commission's guidance](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en).

Tubevra manages local data and the connections described above. Its author is
responsible for their own processing as required by applicable law.
Google/YouTube, SponsorBlock and Return YouTube Dislike are responsible for the processing whose purposes
and means they determine within their services. For requests about that
processing, contact the respective data controllers through the channels in
their privacy policies.

You can delete local settings and site data as described in
[Removing your data](#removing-your-data). This does not delete data held by
external services.

Questions about Tubevra can be raised in the
[project repository](https://github.com/sthomsonpl/Tubevra); do not post cookies,
tokens or personal data publicly.

## Return YouTube Dislike

Return YouTube Dislike is disabled by default. When enabled, it identifies the confirmed playing video in YouTube TV and fetches ratings even while the dock is hidden.
When called, it sends a full video ID to returnyoutubedislikeapi.com to retrieve
Like/Dislike estimates. The provider receives your IP address and request metadata.
Requests use a separate temporary session without YouTube cookies or account
credentials. No votes are sent. Results stay in RAM and are cleared on disable or
exit; only rate-limit timestamps survive disable/re-enable within the process.
Disable the extension to stop requests. See [attribution](THIRD_PARTY_NOTICES.md).

The local ratings panel displays the existing RYD result with the dock and briefly
after a confirmed change of video.
Showing or hiding it does not create additional RYD requests or transmit its contents.
