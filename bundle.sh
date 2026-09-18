# 1. Create the base tar with git-tracked files (respects .gitignore)
git archive --format=tar -o project_bundle.tar HEAD

# 2. Save all compose images to a temporary archive and append it
docker save $(docker compose config --images) -o image.tar
tar -rf project_bundle.tar image.tar
rm image.tar
