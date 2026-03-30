const { 
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    ChannelType,
    PermissionsBitField,
    StringSelectMenuBuilder
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;

let runs = {};
let userRuns = {};

// 🔥 STARTUP CLEANUP
client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const guilds = client.guilds.cache;

    for (const guild of guilds.values()) {
        const channels = await guild.channels.fetch();

        channels.forEach(channel => {
            if (channel && channel.name && channel.name.startsWith("run-")) {
                channel.delete().catch(() => {});
            }
        });
    }

    console.log("Cleaned up old run channels");
});

// BUTTONS
function mainButtons(runId, isFull) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_${runId}`)
            .setLabel(isFull ? "FULL" : "Join")
            .setStyle(ButtonStyle.Success)
            .setDisabled(isFull),

        new ButtonBuilder()
            .setCustomId(`leave_${runId}`)
            .setLabel("Leave")
            .setStyle(ButtonStyle.Danger)
    );
}

function joinOnlyButton(runId, isFull) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_${runId}`)
            .setLabel(isFull ? "FULL" : "Join")
            .setStyle(ButtonStyle.Success)
            .setDisabled(isFull)
    );
}

// 🔥 UPDATE MAIN MESSAGE
async function updateRunMessage(interaction, runId) {
    const run = runs[runId];
    if (!run) return;

    const channel = interaction.channel;
    const msg = await channel.messages.fetch(run.messageId).catch(() => null);
    if (!msg) return;

    const total = run.players.length + run.fillers;
    const full = total >= run.max;
    const spotsLeft = run.max - total;

    await msg.edit({
        content: `🚨 **NEW RUN ALERT!**
Join Terror Zone Runs on Non-Ladder hosted by <@${run.host}>. There are ${spotsLeft} spots left.`,
        components: [mainButtons(runId, full)]
    });
}

client.on(Events.InteractionCreate, async interaction => {

    // ================= COMMANDS =================
    if (interaction.isChatInputCommand()) {

        // HOST
        if (interaction.commandName === 'host') {

            if (userRuns[interaction.user.id]) {
                return interaction.reply({ content: "You are already in a run.", ephemeral: true });
            }

            await interaction.deferReply();

            const runId = Date.now();
            const host = interaction.user;

            const game = `run-${Math.floor(Math.random() * 1000)}`;
            const pass = Math.floor(100 + Math.random() * 900);

            const channel = await interaction.guild.channels.create({
                name: game,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: host.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });

            runs[runId] = {
                host: host.id,
                players: [host.id],
                fillers: 0,
                max: 8,
                channelId: channel.id,
                messageId: null,
                game,
                pass
            };

            userRuns[host.id] = runId;

            await channel.send(`Game: **${game}**\nPassword: **${pass}**`);

            // 🔥 FILLER DROPDOWN (PRIVATE CHANNEL)
            await channel.send({
                content: "Set filler spots (host only):",
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`filler_${runId}`)
                            .setPlaceholder("Select filler spots")
                            .addOptions(
                                Array.from({ length: 8 }, (_, i) => ({
                                    label: `${i} filler spots`,
                                    value: String(i)
                                }))
                            )
                    )
                ]
            });

            const spotsLeft = runs[runId].max - (runs[runId].players.length + runs[runId].fillers);

            const msg = await interaction.editReply({
                content: `🚨 **NEW RUN ALERT!**
Join Terror Zone Runs on Non-Ladder hosted by <@${host.id}>. There are ${spotsLeft} spots left.`,
                components: [mainButtons(runId, false)]
            });

            runs[runId].messageId = msg.id;

            // AUTO DELETE
            setTimeout(async () => {
                const run = runs[runId];
                if (!run) return;

                const channel = await interaction.guild.channels.fetch(run.channelId).catch(() => null);
                if (channel) {
                    await channel.send("⏰ Run expired after 45 minutes.");
                    await channel.delete().catch(() => {});
                }

                run.players.forEach(u => delete userRuns[u]);
                delete runs[runId];

            }, 45 * 60 * 1000);

            // END BUTTON
            await interaction.followUp({
                content: "End your run:",
                ephemeral: true,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`end_${runId}`)
                            .setLabel("End Run")
                            .setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        // LEAVE
        if (interaction.commandName === 'leave') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "You are not in a run.", ephemeral: true });

            await leaveRun(interaction, runId);
            await updateRunMessage(interaction, runId);

            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // END
        if (interaction.commandName === 'endrun') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "No run.", ephemeral: true });

            const run = runs[runId];
            if (run.host !== interaction.user.id) {
                return interaction.reply({ content: "Only host can end.", ephemeral: true });
            }

            await endRun(interaction, runId);
            await interaction.reply("Run ended.");
        }
    }

    // ================= BUTTONS =================
    if (interaction.isButton()) {

        const [action, runId] = interaction.customId.split("_");
        const run = runs[runId];
        if (!run) return interaction.reply({ content: "Run not found.", ephemeral: true });

        const user = interaction.user;

        if (action === "join") {

            if (userRuns[user.id]) {
                return interaction.reply({ content: "You are already in another run.", ephemeral: true });
            }

            const total = run.players.length + run.fillers;

            if (total >= run.max) {
                return interaction.reply({ content: "Run is full.", ephemeral: true });
            }

            run.players.push(user.id);
            userRuns[user.id] = runId;

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.permissionOverwrites.edit(user.id, { ViewChannel: true });

            await updateRunMessage(interaction, runId);

            const spotsLeft = run.max - (run.players.length + run.fillers);

            await interaction.reply({
                content: `<@${user.id}> has been added to <@${run.host}>'s run. There are ${spotsLeft} spots left.`,
                components: [joinOnlyButton(runId, (run.players.length + run.fillers) >= run.max)]
            });
        }

        if (action === "leave") {

            await leaveRun(interaction, runId);
            await updateRunMessage(interaction, runId);

            await interaction.reply({
                content: `${interaction.user} left the run.`
            });
        }

        if (action === "end") {

            if (run.host !== user.id) {
                return interaction.reply({ content: "Only host can end.", ephemeral: true });
            }

            await endRun(interaction, runId);
            await interaction.reply("Run ended.");
        }
    }

    // ================= DROPDOWN =================
    if (interaction.isStringSelectMenu()) {

        const [action, runId] = interaction.customId.split("_");
        const run = runs[runId];
        if (!run) return;

        if (interaction.user.id !== run.host) {
            return interaction.reply({ content: "Only host can set fillers.", ephemeral: true });
        }

        if (action === "filler") {

            const oldFillers = run.fillers;
            run.fillers = parseInt(interaction.values[0]);

            await updateRunMessage(interaction, runId);

            const spotsLeft = run.max - (run.players.length + run.fillers);

            // ✅ PUBLIC MESSAGE (LIKE JOIN LOG)
            await interaction.reply({
                content: `⚙️ <@${interaction.user.id}> set filler spots from ${oldFillers} to ${run.fillers}. There are ${spotsLeft} spots left.`
            });
        }
    }
});

// FUNCTIONS
async function leaveRun(interaction, runId) {
    const run = runs[runId];
    if (!run) return;

    const user = interaction.user;

    run.players = run.players.filter(id => id !== user.id);
    delete userRuns[user.id];

    const channel = await interaction.guild.channels.fetch(run.channelId).catch(() => null);
    if (channel) await channel.permissionOverwrites.delete(user.id).catch(() => {});

    if (run.host === user.id) {
        if (run.players.length > 0) {
            run.host = run.players[0];
            if (channel) {
                await channel.permissionOverwrites.edit(run.host, { ViewChannel: true });
                await channel.send(`<@${run.host}> is now the new host.`);
            }
        } else {
            if (channel) await channel.delete().catch(() => {});
            delete runs[runId];
        }
    }
}

async function endRun(interaction, runId) {
    const run = runs[runId];
    if (!run) return;

    const channel = await interaction.guild.channels.fetch(run.channelId).catch(() => null);
    if (channel) await channel.delete().catch(() => {});

    run.players.forEach(u => delete userRuns[u]);
    delete runs[runId];
}

client.login(TOKEN);
