const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1485043419670646975";
const GUILD_ID = "1481763556687872274";

const commands = [
    new SlashCommandBuilder().setName('host').setDescription('Start run'),
    new SlashCommandBuilder().setName('leave').setDescription('Leave run'),
    new SlashCommandBuilder().setName('runs').setDescription('Show runs'),
    new SlashCommandBuilder().setName('endrun').setDescription('End run')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );
    console.log("Commands deployed");
})();