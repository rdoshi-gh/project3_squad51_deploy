# Automatic Render deployments

The production service uses the Render GitHub App connection for
`rdoshi-gh/project3_squad51_deploy`, branch `main`, with Auto-Deploy set to
On Commit. The GitHub App must retain access to this repository so Render can
receive push events.

Render uses `webapp` as its root directory. Changes inside this directory on
`main` trigger a build (`npm ci`) and restart (`npm start`). Changes only outside
this directory do not trigger a service deployment. Other branches do not update
production.

Check the commit and deployment status in the service dashboard:
https://dashboard.render.com/web/srv-dbpo1lec6qcc73e3g2hg

Live site: https://popping-pos-squad51-z8cf.onrender.com
