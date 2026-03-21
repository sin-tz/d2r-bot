const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
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

client.on(Events.InteractionCreate, async interaction => {

    // ================= COMMANDS =================
    if (interaction.isChatInputCommand()) {

        // 🔥 HOST
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
                players: [],
                max: 8,
                channelId: channel.id,
                messageId: null,
                game,
                pass
            };

            userRuns[host.id] = runId;

            await channel.send(`Game: **${game}**\nPassword: **${pass}**`);

            const embed = new EmbedBuilder()
                .setTitle("NEW RUN ALERT!")
                .setDescription(`Join TZ run hosted by ${host}`)
                .setColor(0x2b2d31);

            const joinBtn = new ButtonBuilder()
                .setCustomId(`join_${runId}`)
                .setLabel("Join")
                .setStyle(ButtonStyle.Success);

            const leaveBtn = new ButtonBuilder()
                .setCustomId(`leave_${runId}`)
                .setLabel("Leave")
                .setStyle(ButtonStyle.Danger);

            const endBtn = new ButtonBuilder()
                .setCustomId(`end_${runId}`)
                .setLabel("End")
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(joinBtn, leaveBtn, endBtn);

            const msg = await interaction.reply({
                embeds: [embed],
                components: [row],
                fetchReply: true
            });

            runs[runId].messageId = msg.id;
        }

        // 🔥 RUNS
        if (interaction.commandName === 'runs') {

            if (Object.keys(runs).length === 0) {
                return interaction.reply("No active runs.");
            }

            await interaction.reply("**Active Runs:**");

            for (let id in runs) {
                const r = runs[id];
                const full = r.players.length >= r.max;

                const link = `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${r.messageId}`;

                const embed = new EmbedBuilder()
                    .setTitle("Run")
                    .setDescription(`Host: <@${r.host}>\nPlayers: ${r.players.length}/${r.max}\nStatus: ${full ? "FULL" : "Active"}`)
                    .setColor(0x2b2d31);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`join_${id}`)
                        .setLabel(full ? "FULL" : "Join")
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(full),

                    new ButtonBuilder()
                        .setLabel("View")
                        .setStyle(ButtonStyle.Link)
                        .setURL(link)
                );

                await interaction.followUp({
                    embeds: [embed],
                    components: [row]
                });
            }
        }

        // 🔥 LEAVE COMMAND
        if (interaction.commandName === 'leave') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "You are not in a run.", ephemeral: true });

            await handleLeave(interaction, runId);
            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // 🔥 END COMMAND
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

            let row;

            if (run.players.length >= run.max) {
                const disabledJoin = new ButtonBuilder()
                    .setCustomId(`join_${runId}`)
                    .setLabel("FULL")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);

                row = new ActionRowBuilder().addComponents(
                    disabledJoin,
                    new ButtonBuilder().setCustomId(`leave_${runId}`).setLabel("Leave").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`end_${runId}`).setLabel("End").setStyle(ButtonStyle.Secondary)
                );
            } else {
                row = interaction.message.components[0];
            }

            await interaction.update({ components: [row] });

            await interaction.followUp({
                content: `${user} joined the run. ${spotsLeft} spots left.`
            });
        }

        // LEAVE
        if (action === "leave") {
            await handleLeave(interaction, runId);
            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // END
        if (action === "end") {

            if (run.host !== user.id) {
                return interaction.reply({ content: "Only host can end this run.", ephemeral: true });
            }

            await endRun(interaction, runId);

            await interaction.update({
                content: "Run ended.",
                embeds: [],
                components: []
            });
        }
    }
});

// ================= FUNCTIONS =================

async function handleLeave(interaction, runId) {
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
