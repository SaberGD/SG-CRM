# CRM Deployment Notes

This CRM project is automatically deployed to Hostinger using GitHub Actions.

Do not delete or modify:

.github/workflows/deploy.yml

The workflow runs automatically on every push to the main branch.

Deployment process:

1. Install dependencies:
   npm install

2. Build the project:
   npm run build

3. Upload the contents of the dist folder to Hostinger using FTP.

Credentials are stored in GitHub Actions Secrets:

- FTP_SERVER
- FTP_USERNAME
- FTP_PASSWORD

FTP configuration:

- FTP_SERVER = ftp.sabergroupacademy.com
- FTP_USERNAME = u570689065.crm
- FTP_PASSWORD = stored securely in GitHub Secrets only

Never hard-code FTP credentials in the project files.
