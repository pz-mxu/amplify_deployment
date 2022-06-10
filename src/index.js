import core from "@actions/core"
import aws from "aws-sdk"
import axios from "axios"
import { readFileSync } from "fs"

const appId = core.getInput("appId")
const branchName = core.getInput("branchName")
const artifactPath = core.getInput("artifactPath")
const region = core.getInput("region")

var amplify = new aws.Amplify({ region })

const cancelPending = async (deployParams) => {
  const { jobSummaries } = await amplify.listJobs(deployParams).promise()
  jobSummaries
    .filter((job) => job.status === "PENDING")
    .forEach(async ({ jobId }) => {
      const { jobSummary } = await amplify.stopJob({ ...deployParams, jobId }).promise()
      console.log(`Canceled job ${jobSummary.jobId}`)
    })
}

const createDeployment = async (deployParams) => {
  await cancelPending(deployParams)

  return amplify
    .createDeployment(deployParams)
    .promise()
    .catch((e) => {
      core.setFailed(e.stack)
      throw Error(e)
    })
}

const startDeployment = (params) => {
  return amplify
    .startDeployment(params)
    .promise()
    .catch((e) => {
      core.setFailed(e.stack)
      throw Error(e)
    })
}

const uploadArtifact = (deploymentResult, artifactPath) => {
  const { zipUploadUrl } = deploymentResult
  console.log(deploymentResult)

  const data = readFileSync(artifactPath)

  return axios
    .put(zipUploadUrl, data, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { "Content-Type": "application/zip" },
    })
    .then(({ data }) => {
      console.log(data)
    })
}

let createdDeployment

createDeployment({ appId, branchName })
  .then((result) => {
    createdDeployment = result
    return result
  })
  .then((createdDeployment) => uploadArtifact(createdDeployment, artifactPath))
  .then(() => {
    const { jobId } = createdDeployment
    return startDeployment({ appId, branchName, jobId })
  })
  .then((createdDeployment) => {
    core.setOutput("jobId", createdDeployment.jobId)
    console.log(createdDeployment)
  })
  .catch(async (e) => {
    const { jobId } = createdDeployment || {}
    if (jobId) {
      console.log(`Error detected, stopping amplify job ${jobId}`)
      const { jobSummary } = await amplify.stopJob({ appId, branchName, jobId }).promise()
      console.log(`Job ${jobSummary.jobId} was stopped`)
    }
    core.setFailed(e.stack)
    throw Error(e)
  })
