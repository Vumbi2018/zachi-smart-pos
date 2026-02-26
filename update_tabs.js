const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public', 'js');

fs.readdirSync(dir).forEach(file => {
    if (file.endsWith('.js')) {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;

        // Replace `<div class="tabs">` precisely
        content = content.replace(/class=\"tabs\"/g, 'class="premium-tabs"');
        content = content.replace(/class=\"tabs /g, 'class="premium-tabs ');
        
        // Same for `.tab`
        content = content.replace(/class=\"tab\"/g, 'class="premium-tab"');
        content = content.replace(/class=\"tab /g, 'class="premium-tab ');
        
        // Update query selectors
        content = content.replace(/\.querySelectorAll\(['"]\.tab['"]\)/g, '.querySelectorAll(".premium-tab")');

        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Updated ' + file);
        }
    }
});
