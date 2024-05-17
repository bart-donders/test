#!/bin/bash
# run this script to test this composite action using act

# Check if required tokens are set
if [[ -z "${GITHUB_TOKEN}" ]]; then
  echo "Please set your github token: export GITHUB_TOKEN=xxx";
  exit 1;
fi

if [[ -z "${CLOUDSMITH_API_KEY}" ]]; then
  echo "Please set your cloudsmith API key: export CLOUDSMITH_API_KEY=xxx";
  exit 1;
fi

# Store script path
SCRIPTPATH="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"

# Move to the .github folder, and then to the main project dir, so that we run act from the project root.
while [[ $PWD != '/' && ${PWD##*/} != '.github' ]]; do cd ..; done; cd ..

# Run act for this action
act workflow_call \
  --secret GITHUB_TOKEN=${GITHUB_TOKEN} \
  --secret CSC_CLOUDSMITH_API_KEY=${CLOUDSMITH_API_KEY} \
  --workflows "$SCRIPTPATH"
