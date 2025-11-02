# Campus Charity Auction — English Auction Site

A simple, modern website that showcases an English Auction event with images, descriptive content, credits, and a functional enquiry form.

## What’s inside

- Frontend: Static site (`public/`) with responsive layout and accessible SVG images
- Backend: Minimal Express server (`server.js`) serving static files and handling enquiries
- Data: Enquiries are stored in `data/enquiries.json`

## Run locally (Windows PowerShell)

1. Install dependencies

```powershell
npm install
```

2. Start the server

```powershell
npm start
```

3. Open the site

- Visit http://localhost:3000 in your browser.

## API

- `POST /api/enquiry`
  - Body (JSON): `{ name: string, email: string, message: string }`
  - Response: `{ ok: boolean, message?: string, errors?: string[] }`

## Project structure

```
BOB/
├─ public/
│  ├─ index.html       # Main page with all required sections
│  ├─ styles.css       # Styling
│  ├─ app.js           # Enquiry form submission logic
│  └─ images/          # High-quality SVG images (gavel, bidders, auctioneer, hall)
├─ data/
│  └─ enquiries.json   # Stored form submissions
├─ server.js           # Express server and /api/enquiry endpoint
├─ package.json        # Scripts and dependencies
└─ README.md
```

## Notes

- The enquiry form is fully functional and stores submissions to `data/enquiries.json`.
- For production, you may add email notifications (e.g., with Nodemailer). This demo keeps dependencies minimal and avoids external services.
- SVGs are used so images look crisp at any resolution and load quickly.
