const { inputToConfig } = require("@ethereum-waffle/compiler");
const { assert, expect } = require("chai");
const { ethers, deployments, network } = require("hardhat");
const { check } = require("prettier");
const {
    developmentChains,
    networkConfig,
} = require("../../helper-hardhat.config");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle", function () {
          let raffle, vrfCoordinatorV2Mock;
          let deployer;
          let player;
          let entranceFee;
          let interval;

          const accounts = ethers.getSigners();
          const chainId = network.config.chainId;

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer;

              await deployments.fixture("all");

              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract(
                  "VRFCoordinatorV2Mock",
                  deployer
              );

              entranceFee = await raffle.getEntranceFee();
              interval = await raffle.getInterval();
          });

          describe("Constructor", function () {
              it("initializes the variables correctly", async function () {
                  const raffleState = await raffle.getRaffleState();
                  const interval = await raffle.getInterval();

                  assert.equal(raffleState.toString(), "0");
                  assert.equal(
                      interval.toString(),
                      networkConfig[chainId]["interval"]
                  );
              });
          });

          describe("Enter Raffle", function () {
              it("Checks if enough ETH is entered", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughEthEntered"
                  );
              });

              it("Adding players", async function () {
                  await raffle.enterRaffle({ value: entranceFee });

                  const rafflePlayer = await raffle.getPlayer(0);
                  assert.equal(deployer, rafflePlayer);
              });

              it("Emits event enter raffle", async function () {
                  await expect(
                      raffle.enterRaffle({ value: entranceFee })
                  ).to.emit(raffle, "RaffleEnter");
              });

              it("Doesn't allow entrance when raffle is calculating", async function () {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);

                  await raffle.performUpkeep([]);
                  await expect(
                      raffle.enterRaffle({ value: entranceFee })
                  ).to.be.revertedWith("Raffle__NotOpen");
              });
          });

          describe("Check Up Keep", function () {
              it("Doesn't allow if people haven't send any eth", async function () {
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);

                  /* Since checkupkeep is a public function, it will run as a transaction
                    Hence we don't use await raffle.checkupkeep()
                    Instead callStatic is used
                */

                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  );
                  assert(!upkeepNeeded);
              });

              it("Doesn't allow if raffle state is calculating(closed)", async function () {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]); // or raffle.performUpkeep("0x")
                  const raffleState = await raffle.getRaffleState();
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  );

                  assert.equal(raffleState.toString(), "1");
                  assert.equal(upkeepNeeded, false);
              });

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() - 5,
                  ]); // use a higher number here if this test fails
                  await network.provider.request({
                      method: "evm_mine",
                      params: [],
                  });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      "0x"
                  ); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded);
              });
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.request({
                      method: "evm_mine",
                      params: [],
                  });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      "0x"
                  ); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded);
              });
          });

          describe("Perform Upkeep", function () {
              it("can only run if checkupkeep is true", async function () {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  const tx = await raffle.performUpkeep("0x");
                  assert(tx);
              });

              it("reverts if upkeep is needed or checkupkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  );
              });

              it("updates raffle state and emits a request id", async function () {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.request({
                      method: "evm_mine",
                      params: [],
                  });

                  const txResponse = await raffle.performUpkeep("0x");
                  const txReceipt = await txResponse.wait(1);
                  const raffleState = await raffle.getRaffleState();
                  const requestId = txReceipt.events[1].args.requestId;

                  assert.equal(raffleState.toString(), "1");
                  assert(requestId.toNumber() > 0);
              });
          });

          describe("fulfill random words", function () {
              // we want to have someone entered the raffle before every test
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
              });

              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
              });

              it("picks a winner, resets the lottery and sends money", async function () {
                  const additionalNumbers = 3;
                  const startAccountIndex = 1; // deployer 0;
                  const players = await ethers.getSigners();

                  for (
                      let i = startAccountIndex;
                      i < startAccountIndex + additionalNumbers;
                      i++
                  ) {
                      const playerConnectedRaffle = raffle.connect(players[i]);
                      await playerConnectedRaffle.enterRaffle({
                          value: entranceFee,
                      });
                  }

                  const startingTimeStamp = await raffle.getLastTimeStamp();

                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          try {
                              const recentWinner =
                                  await raffle.getRecentWinner();
                              const numberPlayers =
                                  await raffle.getNumberOfPlayers();
                              const lastTimeStamp =
                                  await raffle.getLastTimeStamp();

                              const raffleState = await raffle.getRaffleState();
                          } catch (e) {
                              reject(e);
                          }

                          resolve();
                      });

                      // we mock being chainlink vrf and keepers to kick off the fulfillRandomWords function
                      const tx = await raffle.performUpkeep("0x");
                      const txReceipt = await tx.wait(1);
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      );
                  });
              });
          });
      });
