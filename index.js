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

    // ========================
    // SLASH COMMANDS
    // ========================
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

        // 🔥 LEAVE COMMAND
        if (interaction.commandName === 'leave') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "You are not in a run.", ephemeral: true });

            const run = runs[runId];

            run.players = run.players.filter(id => id !== interaction.user.id);
            delete userRuns[interaction.user.id];

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.permissionOverwrites.delete(interaction.user.id);

            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // 🔥 RUNS LIST
        if (interaction.commandName === 'runs') {
            if (Object.keys(runs).length === 0) {
                return interaction.reply("No active runs.");
            }

            let text = "**Active Runs:**\n\n";

            for (let id in runs) {
                const r = runs[id];
                text += `<@${r.host}> — ${r.players.length}/${r.max}\n`;
            }

            await interaction.reply(text);
        }

        // 🔥 END RUN COMMAND
        if (interaction.commandName === 'endrun') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "You are not in a run.", ephemeral: true });

            const run = runs[runId];

            if (run.host !== interaction.user.id) {
                return interaction.reply({ content: "Only host can end run.", ephemeral: true });
            }

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.delete();

            run.players.forEach(u => delete userRuns[u]);
            delete userRuns[run.host];
            delete runs[runId];

            await interaction.reply("Run ended.");
        }
    }

    // ========================
    // BUTTONS
    // ========================
    if (interaction.isButton()) {

        const [action, runId] = interaction.customId.split("_");
        const run = runs[runId];

        if (!run) return interaction.reply({ content: "Run not found.", ephemeral: true });

        if (interaction.message.id !== run.messageId) return;

        const user = interaction.user;

        // 🔥 JOIN
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

            await channel.permissionOverwrites.edit(user.id, {
                ViewChannel: true
            });

            const spotsLeft = run.max - run.players.length;

            let row;

            if (run.players.length >= run.max) {
                const disabledJoin = new ButtonBuilder()
                    .setCustomId(`join_${runId}`)
                    .setLabel("FULL")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);

                const leaveBtn = new ButtonBuilder()
                    .setCustomId(`leave_${runId}`)
                    .setLabel("Leave")
                    .setStyle(ButtonStyle.Danger);

                const endBtn = new ButtonBuilder()
                    .setCustomId(`end_${runId}`)
                    .setLabel("End")
                    .setStyle(ButtonStyle.Secondary);

                row = new ActionRowBuilder().addComponents(disabledJoin, leaveBtn, endBtn);
            } else {
                row = interaction.message.components[0];
            }

            await interaction.update({
                components: [row]
            });

            await interaction.followUp({
                content: `${user} joined the run. ${spotsLeft} spots left.`
            });
        }

        // 🔥 LEAVE BUTTON
        if (action === "leave") {

            if (!userRuns[user.id]) {
                return interaction.reply({ content: "You are not in a run.", ephemeral: true });
            }

            if (userRuns[user.id] !== runId) {
                return interaction.reply({ content: "You are in another run.", ephemeral: true });
            }

            run.players = run.players.filter(id => id !== user.id);
            delete userRuns[user.id];

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.permissionOverwrites.delete(user.id);

            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // 🔥 END BUTTON
        if (action === "end") {

            if (run.host !== user.id) {
                return interaction.reply({ content: "Only host can end this run.", ephemeral: true });
            }

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.delete();

            run.players.forEach(u => delete userRuns[u]);
            delete userRuns[run.host];
            delete runs[runId];

            await interaction.update({
                content: "Run ended.",
                embeds: [],
                components: []
            });
        }
    }
});

client.login(TOKEN);