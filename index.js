const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    ChannelType,
    PermissionsBitField
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;

let runs = {};
let userRuns = {};

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// 🔘 BUTTON ROW (NO END BUTTON PUBLIC)
function createButtons(runId, isFull) {
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

client.on(Events.InteractionCreate, async interaction => {

    // ================= COMMANDS =================
    if (interaction.isChatInputCommand()) {

        // HOST
        if (interaction.commandName === 'host') {

            if (userRuns[interaction.user.id]) {
                return interaction.reply({ content: "You are already in a run.", ephemeral: true });
            }

            const runId = Date.now();
            const host = interaction.user;

            const game = `run-${Math.floor(Math.random() * 1000)}`;
            const pass = Math.floor(100 + Math.random() * 900);

            const channel = await interaction.guild.channels.create({
                name: `run-${game}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: host.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });

            runs[runId] = {
                host: host.id,
                players: [host.id],
                max: 8,
                channelId: channel.id,
                messageId: null,
                game,
                pass
            };

            userRuns[host.id] = runId;

            await channel.send(`Game: **${game}**\nPassword: **${pass}**`);

            // MAIN MESSAGE
            const mainMsg = await interaction.reply({
                content:
`**NEW RUN ALERT!**
Join Terror Zone Runs on Non-Ladder hosted by ${host}`,
                components: [createButtons(runId, false)],
                fetchReply: true
            });

            runs[runId].messageId = mainMsg.id;

            const spotsLeft = runs[runId].max - runs[runId].players.length;

            // ACTIVITY MESSAGE
            await interaction.followUp({
                content: `${host} has started a run. There are ${spotsLeft} spots left.`,
                components: [createButtons(runId, false)]
            });

            // 🔴 PRIVATE END BUTTON FOR HOST
            await interaction.followUp({
                content: "You can end your run here:",
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

        // RUNS
        if (interaction.commandName === 'runs') {

            if (Object.keys(runs).length === 0) {
                return interaction.reply("No active runs.");
            }

            await interaction.reply("**Active Runs:**");

            for (let id in runs) {
                const r = runs[id];
                const full = r.players.length >= r.max;

                const link = `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${r.messageId}`;

                await interaction.followUp({
                    content:
`👑 Host: <@${r.host}>
👥 Players: ${r.players.length}/${r.max}
Status: ${full ? "FULL" : "Active"}`,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel("View")
                                .setStyle(ButtonStyle.Link)
                                .setURL(link)
                        )
                    ]
                });
            }
        }

        // LEAVE
        if (interaction.commandName === 'leave') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "You are not in a run.", ephemeral: true });

            await leaveRun(interaction, runId);
            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // END COMMAND
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

        // JOIN
        if (action === "join") {

            if (userRuns[user.id]) {
                return interaction.reply({ content: "You are already in another run.", ephemeral: true });
            }

            if (run.players.length >= run.max) {
                return interaction.reply({ content: "Run is full.", ephemeral: true });
            }

            run.players.push(user.id);
            userRuns[user.id] = runId;

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.permissionOverwrites.edit(user.id, { ViewChannel: true });

            const spotsLeft = run.max - run.players.length;
            const full = run.players.length >= run.max;

            await interaction.reply({
                content: `${user} has been added to <@${run.host}>'s run. There are ${spotsLeft} spots left.`,
                components: [createButtons(runId, full)]
            });
        }

        // LEAVE
        if (action === "leave") {
            await leaveRun(interaction, runId);

            const run = runs[runId];
            const spotsLeft = run ? run.max - run.players.length : 0;

            await interaction.reply({
                content: `${interaction.user} left the run. There are ${spotsLeft} spots left.`,
                components: run ? [createButtons(runId, false)] : []
            });
        }

        // END
        if (action === "end") {

            if (run.host !== user.id) {
                return interaction.reply({ content: "Only host can end this run.", ephemeral: true });
            }

            await endRun(interaction, runId);

            await interaction.reply("Run ended.");
        }
    }
});

// ================= FUNCTIONS =================

async function leaveRun(interaction, runId) {
    const run = runs[runId];
    const user = interaction.user;

    run.players = run.players.filter(id => id !== user.id);
    delete userRuns[user.id];

    const channel = await interaction.guild.channels.fetch(run.channelId);
    await channel.permissionOverwrites.delete(user.id);

    if (run.host === user.id) {
        if (run.players.length > 0) {
            run.host = run.players[0];
            await interaction.followUp({ content: `<@${run.host}> is now the new host.` });
        } else {
            await channel.delete();
            delete runs[runId];
        }
    }
}

async function endRun(interaction, runId) {
    const run = runs[runId];

    const channel = await interaction.guild.channels.fetch(run.channelId);
    await channel.delete();

    run.players.forEach(u => delete userRuns[u]);
    delete userRuns[run.host];
    delete runs[runId];
}

client.login(TOKEN);
