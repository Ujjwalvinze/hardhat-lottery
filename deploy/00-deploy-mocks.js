const { network, ethers } = require("hardhat");
const { developmentChains } = require("../helper-hardhat.config");
module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments;
    const { deployer } = await getNamedAccounts();
    const chainId = network.config.chainId;

    const BASE_FEE = ethers.utils.parseEther("0.25");
    const GAS_PRICE_LINK = 1e9; // gas per link. calculated gas price for the nodes of chainlink
    if (developmentChains.includes(network.name)) {
        //(chainId == "31337") {
        log("Deploying mocks on Local network...");
        await deploy("VRFCoordinatorV2Mock", {
            contract: "VRFCoordinatorV2Mock",
            from: deployer,
            log: true,
            args: [BASE_FEE, GAS_PRICE_LINK],
        });
        log("Mocks Deployed");
        log("---------------------------------------------------------");
    }
};

module.exports.tags = ["all", "mocks"];
