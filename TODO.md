# TODO OVERVIEW

The current state of the app can be found inside the [Screenshots](.claude/screenshots/front-end-example.png) folder. This is going to be the "homepage" of my application, or whatever the user sees first when they navigate to the app after I've deployed it. The app will have multiple pages: The homepage where it will display the current day's MVP rankings, as well as an option to search different dates and see the rankings on that day as well. The second "page" will be for specific players. Here, we should be able to see player specific info, such as rankings over time, seeing the next 10 teams that player will play against, the player's current MVP ranking, links to buy tickets to see them in person, etc.

# FRONT END TASKS

- Update the homepage to include the abililty to search for a specefic date, and display the rankings on that day.

- Additionaly, add another tab at the top that when clicked, switches the app to the player view.

- On the player view, we should have the player profile, their stats, their MVP ranking as of today, as well as a graph to show their MVP ranking over time. This graph should be a line graph. This time range should be adjustable, with the maximum range being one month.

- Add some placeholders for the extra features like the next 10 teams the player will play against, and links to buy tickets for those games.

- if we click a player profile picture in the dropdown on the home page, we should redirect to that player's page on the other view. As a little front end feature, when a user hovers their mouse over the player profile picture, there should transition to an overlay over the picture with something like "click to view player profile"

# BACK END TASKS

- create the neccessary routes to obtain all the information in the front end. Try to follow similar structure to how the current routes are being written in the [routes](src/api/routes).

- if new types are required to be created, create them in the [types](src/utils/types.ts) file.

- there are currently some gaps in the database where there is no info on days where the web scrapping portion failed. Make sure to handle the case where the specified date has no data. We will fix the automation in a separate task.
